/**
 * HA Core WebSocket API emulation (/core/websocket).
 */
import { buildCoreConfig } from './coreRoutes.mjs'
import { newContext } from './homeState.mjs'
import { buildEntityRegistryForDisplay } from './registries.mjs'
import { HA_VERSION } from './seedData.mjs'
import {
    SERVICE_CATALOGUE,
    callService,
} from './services.mjs'
import { WebSocketServer } from './wsLib.mjs'

const CLOSE_SERVICE_RESTART = 1012

/**
 * Command handlers: (context, message) -> result. Throwing { code, message } sends an error result.
 */
const commandHandlers = {
    supported_features: () => null,
    get_states: ({ home }) => [...home.states.values()],
    get_config: ({ home, configEntries }) => buildCoreConfig(home.configDir, configEntries),
    get_services: () => SERVICE_CATALOGUE,
    'config/entity_registry/list': ({ home }) => home.entityRegistry(),
    'config/entity_registry/list_for_display': ({ home }) => buildEntityRegistryForDisplay(home.entityRegistry()),
    'config/entity_registry/get': ({ home }, message) => {
        const entry = home.entityRegistry().find((item) => item.entity_id === message.entity_id)
        if (!entry) {
            throw { code: 'not_found', message: 'Entity not found' }
        }
        return entry
    },
    'config/device_registry/list': ({ home }) => home.deviceRegistry(),
    'config/area_registry/list': ({ home }) => home.areaRegistry(),
    'config_entries/get': ({ configEntries }, message) => configEntries.entries
        .filter((entry) => !message.domain || entry.domain === message.domain),
    'trace/list': ({ home }, message) => {
        const lists = message.item_id ? [home.traces.get(String(message.item_id)) ?? []] : [...home.traces.values()]
        return lists.flat().map(({ config, context, ...summary }) => summary)
    },
    'trace/get': ({ home }, message) => {
        const trace = (home.traces.get(String(message.item_id)) ?? []).find((item) => item.run_id === message.run_id)
        if (!trace) {
            throw { code: 'not_found', message: 'The trace could not be found' }
        }
        return { ...trace, trace: { 'trigger/0': [{ path: 'trigger/0', timestamp: trace.timestamp.start, changed_variables: {} }] }, error: null }
    },
    call_service: ({ home }, message) => {
        const result = callService(home, message.domain, message.service, message.service_data ?? {}, message.target)
        if (!result.ok) {
            throw { code: 'service_not_found', message: result.error }
        }
        return { context: newContext(), response: null }
    },
}

/**
 * Creates the WS endpoint. Call `handleUpgrade` from the HTTP server's 'upgrade' event.
 *
 * @param {{ home: import('./homeState.mjs').MockHome, configEntries: import('./configEntries.mjs').ConfigEntries }} context mock state
 * @param {string} token accepted access token
 * @returns {{ handleUpgrade: (req: import('node:http').IncomingMessage, socket: import('node:net').Socket, head: Buffer) => void }} endpoint
 */
export function createCoreWebsocket(context, token) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 })
    context.home.on('restart', () => {
        for (const client of wss.clients) {
            client.close(CLOSE_SERVICE_RESTART, 'Home Assistant is restarting')
        }
    })
    wss.on('connection', (socket) => handleConnection(context, token, socket))
    return {
        handleUpgrade(req, socket, head) {
            if (context.home.isCoreDown()) {
                socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
                return
            }
            wss.handleUpgrade(req, socket, head, (client) => wss.emit('connection', client, req))
        },
    }
}

/**
 * @param {{ home: import('./homeState.mjs').MockHome }} context mock state
 * @param {string} token accepted access token
 * @param {import('ws').WebSocket} socket client socket
 */
function handleConnection(context, token, socket) {
    const session = { authenticated: false, subscriptions: new Map() }
    const send = (payload) => socket.send(JSON.stringify(payload))
    const onStateChanged = (data) => {
        for (const [subscriptionId, eventType] of session.subscriptions) {
            if (!eventType || eventType === 'state_changed') {
                send({ id: subscriptionId, type: 'event', event: { event_type: 'state_changed', data, origin: 'LOCAL', time_fired: new Date().toISOString(), context: newContext() } })
            }
        }
    }
    context.home.on('state_changed', onStateChanged)
    socket.on('close', () => context.home.off('state_changed', onStateChanged))
    send({ type: 'auth_required', ha_version: HA_VERSION })
    socket.on('message', (raw) => {
        let parsed
        try {
            parsed = JSON.parse(raw.toString('utf8'))
        } catch {
            socket.close(1003, 'Invalid JSON')
            return
        }
        for (const message of [parsed].flat()) {
            handleMessage(context, token, session, send, socket, message)
        }
    })
}

/**
 * @param {object} context mock state
 * @param {string} token accepted token
 * @param {{ authenticated: boolean, subscriptions: Map<number, string | undefined> }} session connection state
 * @param {(payload: unknown) => void} send sender
 * @param {import('ws').WebSocket} socket client socket
 * @param {Record<string, unknown>} message incoming message
 */
function handleMessage(context, token, session, send, socket, message) {
    if (!session.authenticated) {
        if (message?.type === 'auth' && message.access_token === token) {
            session.authenticated = true
            send({ type: 'auth_ok', ha_version: HA_VERSION })
        } else {
            send({ type: 'auth_invalid', message: 'Invalid access token or password' })
            socket.close()
        }
        return
    }
    const { id, type } = message ?? {}
    if (typeof id !== 'number') {
        send({ type: 'result', success: false, error: { code: 'invalid_format', message: 'Message incorrectly formatted.' } })
        return
    }
    if (type === 'ping') {
        send({ id, type: 'pong' })
        return
    }
    if (type === 'subscribe_events') {
        session.subscriptions.set(id, message.event_type)
        send({ id, type: 'result', success: true, result: null })
        return
    }
    if (type === 'unsubscribe_events') {
        session.subscriptions.delete(message.subscription)
        send({ id, type: 'result', success: true, result: null })
        return
    }
    const handler = commandHandlers[type]
    if (!handler) {
        send({ id, type: 'result', success: false, error: { code: 'unknown_command', message: `Unknown command: ${type}` } })
        return
    }
    try {
        send({ id, type: 'result', success: true, result: handler(context, message) ?? null })
    } catch (error) {
        const code = error?.code ?? 'unknown_error'
        send({ id, type: 'result', success: false, error: { code, message: error?.message ?? String(error) } })
    }
}
