#!/usr/bin/env node
/**
 * Mock Home Assistant Supervisor + Core for local development of the AI automatizace add-on.
 *
 * Env: HA_CONFIG_DIR (required-ish, default ../devdata/config), MOCK_PORT (8124), MOCK_HOST (127.0.0.1),
 *      MOCK_TOKEN (dev-supervisor-token).
 * Debug endpoints without auth: GET /_mock/calls, GET /_mock/backups, POST /_mock/reset-calls.
 */
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfigEntries } from './mock/configEntries.mjs'
import { handleCoreRequest } from './mock/coreRoutes.mjs'
import { createCoreWebsocket } from './mock/coreWebsocket.mjs'
import { MockHome } from './mock/homeState.mjs'
import {
    isAuthorized,
    sendJson,
    sendSupervisorError,
} from './mock/httpUtil.mjs'
import { AddonStore } from './mock/storeData.mjs'
import { handleSupervisorRequest } from './mock/supervisorRoutes.mjs'

const DEFAULT_PORT = 8124
const DEFAULT_TOKEN = 'dev-supervisor-token'
const WEBSOCKET_PATH = '/core/websocket'

/**
 * @param {{ configDir: string, port?: number, host?: string, token?: string }} options server options
 * @returns {Promise<{ server: import('node:http').Server, context: object, port: number, close: () => Promise<void> }>} running mock
 */
export async function startMockSupervisor(options) {
    const configDir = resolve(options.configDir)
    const token = options.token ?? DEFAULT_TOKEN
    const context = { home: new MockHome(configDir), store: new AddonStore(), configEntries: new ConfigEntries() }
    const websocket = createCoreWebsocket(context, token)
    const server = createServer((req, res) => {
        handleRequest(context, token, req, res).catch((error) => {
            const message = error instanceof Error ? error.message : String(error)
            if (!res.headersSent) {
                sendSupervisorError(res, 400, message)
            }
        })
    })
    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url ?? '/', 'http://mock')
        if (url.pathname !== WEBSOCKET_PATH) {
            socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
            return
        }
        websocket.handleUpgrade(req, socket, head)
    })
    await new Promise((resolveListen) => server.listen(options.port ?? DEFAULT_PORT, options.host ?? '127.0.0.1', resolveListen))
    return {
        server,
        context,
        port: server.address().port,
        close: () => new Promise((resolveClose) => {
            server.closeAllConnections()
            server.close(() => resolveClose())
        }),
    }
}

/**
 * @param {object} context mock state
 * @param {string} token accepted token
 * @param {import('node:http').IncomingMessage} req request
 * @param {import('node:http').ServerResponse} res response
 */
async function handleRequest(context, token, req, res) {
    const url = new URL(req.url ?? '/', 'http://mock')
    if (url.pathname.startsWith('/_mock/')) {
        handleDebugRequest(context, req, res, url)
        return
    }
    if (!isAuthorized(req, token)) {
        sendJson(res, 401, { result: 'error', message: '401: Unauthorized' })
        return
    }
    const handled = await handleCoreRequest(context, req, res, url)
        || await handleSupervisorRequest(context, req, res, url)
    if (!handled) {
        sendSupervisorError(res, 404, `Mock: ${req.method} ${url.pathname} not implemented`)
    }
}

/**
 * @param {object} context mock state
 * @param {import('node:http').IncomingMessage} req request
 * @param {import('node:http').ServerResponse} res response
 * @param {URL} url parsed URL
 */
function handleDebugRequest(context, req, res, url) {
    const { home } = context
    if (url.pathname === '/_mock/calls') {
        sendJson(res, 200, home.serviceCalls)
    } else if (url.pathname === '/_mock/backups') {
        sendJson(res, 200, home.backups)
    } else if (url.pathname === '/_mock/reset-calls' && req.method === 'POST') {
        home.serviceCalls.length = 0
        sendJson(res, 200, { ok: true })
    } else {
        sendJson(res, 404, { error: 'unknown debug endpoint' })
    }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
    const configDir = process.env.HA_CONFIG_DIR ?? resolve(fileURLToPath(new URL('../devdata/config', import.meta.url)))
    if (!existsSync(configDir)) {
        console.error(`HA_CONFIG_DIR ${configDir} does not exist`)
        process.exit(1)
    }
    const mock = await startMockSupervisor({
        configDir,
        port: Number(process.env.MOCK_PORT ?? DEFAULT_PORT),
        host: process.env.MOCK_HOST ?? '127.0.0.1',
        token: process.env.MOCK_TOKEN ?? DEFAULT_TOKEN,
    })
    console.log(`[mock-supervisor] listening on http://127.0.0.1:${mock.port} (config ${configDir})`)
    const shutdown = () => mock.close().then(() => process.exit(0))
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
}
