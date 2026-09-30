/**
 * HA Core REST API emulation served under /core/api/* (Supervisor proxy path).
 */
import { checkConfig } from './configCheck.mjs'
import {
    readJsonBody,
    sendJson,
    sendText,
} from './httpUtil.mjs'
import { HA_VERSION } from './seedData.mjs'
import {
    SERVICE_CATALOGUE,
    callService,
} from './services.mjs'

const CORE_PREFIX = '/core/api'
const SERVICE_PATH = /^\/services\/([a-z0-9_]+)\/([a-z0-9_]+)$/
const STATE_PATH = /^\/states\/([a-z0-9_]+\.[a-z0-9_]+)$/
const FLOW_PATH = /^\/config\/config_entries\/flow\/([0-9a-f]{32})$/

/**
 * @param {string} configDir HA config dir
 * @param {import('./configEntries.mjs').ConfigEntries} configEntries config entries
 * @returns {Record<string, unknown>} GET /api/config payload
 */
export function buildCoreConfig(configDir, configEntries) {
    return {
        components: [...new Set(['automation', 'script', 'scene', 'light', 'switch', 'cover', 'sensor', 'binary_sensor', 'person', 'zone', 'hassio', 'default_config', ...configEntries.entries.map((entry) => entry.domain)])],
        config_dir: configDir,
        config_source: 'storage',
        country: 'CZ',
        currency: 'CZK',
        elevation: 245,
        external_url: null,
        internal_url: 'http://homeassistant.local:8123',
        language: 'cs',
        latitude: 49.8175,
        longitude: 15.473,
        location_name: 'Domov',
        radius: 100,
        recovery_mode: false,
        safe_mode: false,
        state: 'RUNNING',
        time_zone: 'Europe/Prague',
        unit_system: { length: 'km', mass: 'g', temperature: '°C', volume: 'L', pressure: 'Pa', wind_speed: 'm/s', accumulated_precipitation: 'mm' },
        version: HA_VERSION,
        whitelist_external_dirs: ['/media', configDir],
        allowlist_external_dirs: ['/media', configDir],
        allowlist_external_urls: [],
    }
}

/**
 * Handles /core/api/* requests. Returns false when the path is not a Core route.
 *
 * @param {{ home: import('./homeState.mjs').MockHome, configEntries: import('./configEntries.mjs').ConfigEntries }} context mock state
 * @param {import('node:http').IncomingMessage} req request
 * @param {import('node:http').ServerResponse} res response
 * @param {URL} url parsed URL
 * @returns {Promise<boolean>} handled
 */
export async function handleCoreRequest(context, req, res, url) {
    if (url.pathname !== CORE_PREFIX && !url.pathname.startsWith(`${CORE_PREFIX}/`)) {
        return false
    }
    const { home, configEntries } = context
    if (home.isCoreDown()) {
        sendText(res, 502, '502 Bad Gateway (Home Assistant Core is restarting)')
        return true
    }
    const path = url.pathname.slice(CORE_PREFIX.length).replace(/\/+$/, '') || '/'
    const method = req.method ?? 'GET'
    const route = `${method} ${path}`
    switch (route) {
    case 'GET /':
        sendJson(res, 200, { message: 'API running.' })
        return true
    case 'GET /config':
        sendJson(res, 200, buildCoreConfig(home.configDir, configEntries))
        return true
    case 'GET /states':
        sendJson(res, 200, [...home.states.values()])
        return true
    case 'GET /services':
        sendJson(res, 200, Object.entries(SERVICE_CATALOGUE).map(([domain, services]) => ({ domain, services })))
        return true
    case 'GET /error_log':
        sendText(res, 200, `${home.logLines.join('\n')}\n`)
        return true
    case 'POST /config/core/check_config':
        sendJson(res, 200, checkConfig(home.configDir))
        return true
    case 'GET /config/config_entries/entry':
        sendJson(res, 200, configEntries.entries)
        return true
    case 'POST /config/config_entries/flow': {
        const body = await readJsonBody(req)
        const result = configEntries.startFlow(body.handler)
        sendJson(res, result.status, result.body)
        return true
    }
    default:
        return handleParameterisedRoute(context, req, res, method, path)
    }
}

/**
 * @param {{ home: import('./homeState.mjs').MockHome, configEntries: import('./configEntries.mjs').ConfigEntries }} context mock state
 * @param {import('node:http').IncomingMessage} req request
 * @param {import('node:http').ServerResponse} res response
 * @param {string} method HTTP method
 * @param {string} path path after /core/api
 * @returns {Promise<boolean>} handled
 */
async function handleParameterisedRoute(context, req, res, method, path) {
    const { home, configEntries } = context
    const stateMatch = STATE_PATH.exec(path)
    if (method === 'GET' && stateMatch) {
        const state = home.states.get(stateMatch[1])
        if (state) {
            sendJson(res, 200, state)
        } else {
            sendJson(res, 404, { message: 'Entity not found.' })
        }
        return true
    }
    const serviceMatch = SERVICE_PATH.exec(path)
    if (method === 'POST' && serviceMatch) {
        const body = await readJsonBody(req)
        const result = callService(home, serviceMatch[1], serviceMatch[2], body)
        if (result.ok) {
            sendJson(res, 200, [])
        } else {
            sendJson(res, 400, { message: result.error })
        }
        return true
    }
    const flowMatch = FLOW_PATH.exec(path)
    if (method === 'POST' && flowMatch) {
        const result = configEntries.continueFlow(flowMatch[1], await readJsonBody(req))
        sendJson(res, result.status, result.body)
        return true
    }
    sendJson(res, 404, { message: `Mock: ${method} ${CORE_PREFIX}${path} not implemented` })
    return true
}
