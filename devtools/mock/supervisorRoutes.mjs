/**
 * Supervisor REST API emulation (everything outside /core/api and /core/websocket).
 */
import { randomUUID } from 'node:crypto'
import {
    readJsonBody,
    sendOk,
    sendSupervisorError,
    sendText,
} from './httpUtil.mjs'
import {
    HA_VERSION,
    OS_VERSION,
    SUPERVISOR_VERSION,
    USB_SERIAL_DEVICE,
} from './seedData.mjs'

const SUPERVISOR_LOG = [
    'INFO (MainThread) [supervisor.bootstrap] Initializing Supervisor setup',
    'INFO (MainThread) [supervisor.core] Supervisor is up and running',
    'INFO (MainThread) [supervisor.addons.addon] Add-on local_ai_automation started',
]

const HOST_LOG = [
    'systemd[1]: Started Home Assistant OS.',
    'kernel: usb 1-1.3: ch341-uart converter now attached to ttyUSB0',
]

const staticRoutes = {
    '/info': () => ({
        supervisor: SUPERVISOR_VERSION, homeassistant: HA_VERSION, hassos: OS_VERSION, docker: '28.3.3',
        hostname: 'homeassistant', operating_system: `Home Assistant OS ${OS_VERSION}`, features: ['reboot', 'shutdown', 'services', 'network', 'hostname', 'timedate', 'os_agent', 'haos', 'journal', 'disk', 'mount'],
        machine: 'raspberrypi5-64', arch: 'aarch64', supported_arch: ['aarch64'], supported: true, channel: 'stable',
        logging: 'info', state: 'running', timezone: 'Europe/Prague',
    }),
    '/core/info': () => ({
        version: HA_VERSION, version_latest: HA_VERSION, update_available: false, machine: 'raspberrypi5-64',
        ip_address: '172.30.32.1', arch: 'aarch64', image: 'ghcr.io/home-assistant/raspberrypi5-64-homeassistant',
        boot: true, port: 8123, ssl: false, watchdog: true, audio_input: null, audio_output: null, backups_exclude_database: false,
    }),
    '/host/info': () => ({
        agent_version: '1.7.2', apparmor_version: '4.0.1', chassis: 'embedded', virtualization: '', cpe: 'cpe:2.3:o:home-assistant:haos:16.2:*:production:*:*:*:rpi5-64:*',
        deployment: 'production', disk_free: 88.4, disk_total: 116.7, disk_used: 23.1, disk_life_time: 3, features: ['reboot', 'shutdown', 'services', 'network', 'hostname', 'timedate', 'os_agent', 'haos', 'journal', 'disk', 'mount'],
        hostname: 'homeassistant', llmnr_hostname: 'homeassistant', kernel: '6.12.34-haos-raspi', operating_system: `Home Assistant OS ${OS_VERSION}`,
        timezone: 'Europe/Prague', dt_utc: new Date().toISOString(), dt_synchronized: true, use_ntp: true, startup_time: 3.2, boot_timestamp: 1727712000000000, broadcast_llmnr: true, broadcast_mdns: true,
    }),
    '/os/info': () => ({
        version: OS_VERSION, version_latest: OS_VERSION, update_available: false, board: 'rpi5-64', boot: 'A', data_disk: '/dev/mmcblk0p8', boot_slots: {},
    }),
    '/hardware/info': () => ({
        devices: [
            USB_SERIAL_DEVICE,
            { name: 'mmcblk0', sysfs: '/sys/devices/platform/emmc2bus/fe340000.mmc/mmc_host/mmc0/mmc0:aaaa/block/mmcblk0', dev_path: '/dev/mmcblk0', subsystem: 'block', by_id: '/dev/disk/by-id/mmc-SC128_0x1234abcd', attributes: { DEVTYPE: 'disk', ID_NAME: 'SC128' }, children: [] },
        ],
        drives: [],
    }),
}

const logRoutes = {
    '/supervisor/logs': () => SUPERVISOR_LOG,
    '/host/logs': () => HOST_LOG,
}

/**
 * Handles one Supervisor request. Returns false when the path is not a Supervisor route.
 *
 * @param {{ home: import('./homeState.mjs').MockHome, store: import('./storeData.mjs').AddonStore }} context mock state
 * @param {import('node:http').IncomingMessage} req request
 * @param {import('node:http').ServerResponse} res response
 * @param {URL} url parsed URL
 * @returns {Promise<boolean>} handled
 */
export async function handleSupervisorRequest(context, req, res, url) {
    const { home, store } = context
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const method = req.method ?? 'GET'
    if (method === 'GET' && staticRoutes[path]) {
        sendOk(res, staticRoutes[path]())
        return true
    }
    if (method === 'GET' && logRoutes[path]) {
        sendText(res, 200, `${logRoutes[path]().join('\n')}\n`)
        return true
    }
    if (method === 'GET' && path === '/core/logs') {
        sendText(res, 200, `${home.logLines.join('\n')}\n`)
        return true
    }
    if (method === 'POST' && path === '/core/restart') {
        home.restartCore()
        sendOk(res)
        return true
    }
    if (path.startsWith('/backups')) {
        return handleBackups(home, req, res, method, path)
    }
    if (path === '/addons' || path.startsWith('/addons/') || path.startsWith('/store')) {
        return handleAddons(store, req, res, method, path)
    }
    return false
}

/**
 * @param {import('./homeState.mjs').MockHome} home mock HA
 * @param {import('node:http').IncomingMessage} req request
 * @param {import('node:http').ServerResponse} res response
 * @param {string} method HTTP method
 * @param {string} path normalised path
 * @returns {Promise<boolean>} handled
 */
async function handleBackups(home, req, res, method, path) {
    if (method === 'GET' && path === '/backups') {
        sendOk(res, { backups: home.backups })
        return true
    }
    const kind = { '/backups/new/partial': 'partial', '/backups/new/full': 'full' }[path]
    if (method !== 'POST' || !kind) {
        return false
    }
    const body = await readJsonBody(req)
    const backup = {
        slug: randomUUID().replaceAll('-', '').slice(0, 8),
        name: typeof body.name === 'string' ? body.name : `Záloha ${new Date().toISOString()}`,
        date: new Date().toISOString(),
        type: kind,
        size: 12.3,
        protected: false,
        content: { homeassistant: body.homeassistant !== false, addons: body.addons ?? [], folders: body.folders ?? [] },
    }
    home.backups.push(backup)
    home.log(`INFO (MainThread) [supervisor.backups.manager] Creating ${kind} backup ${backup.name} (${backup.slug})`)
    sendOk(res, { slug: backup.slug, job_id: randomUUID().replaceAll('-', '') })
    return true
}

/**
 * @param {import('./storeData.mjs').AddonStore} store add-on store
 * @param {import('node:http').IncomingMessage} req request
 * @param {import('node:http').ServerResponse} res response
 * @param {string} method HTTP method
 * @param {string} path normalised path
 * @returns {Promise<boolean>} handled
 */
async function handleAddons(store, req, res, method, path) {
    const segments = path.split('/').filter(Boolean)
    if (method === 'GET' && path === '/addons') {
        sendOk(res, { addons: store.installedAddons() })
        return true
    }
    if (method === 'GET' && (path === '/store' || path === '/store/addons')) {
        sendOk(res, path === '/store' ? { addons: store.storeAddons(), repositories: store.repositories } : { addons: store.storeAddons() })
        return true
    }
    if (method === 'GET' && path === '/store/repositories') {
        sendOk(res, store.repositories)
        return true
    }
    if (method === 'POST' && path === '/store/repositories') {
        const body = await readJsonBody(req)
        const error = store.addRepository(body.repository)
        return respond(res, error, {})
    }
    if (method === 'POST' && path === '/store/reload') {
        sendOk(res)
        return true
    }
    const isStoreAddon = segments[0] === 'store' && segments[1] === 'addons'
    const slug = isStoreAddon ? segments[2] : segments[1]
    const action = isStoreAddon ? segments[3] : segments[2]
    if (!slug) {
        return false
    }
    if (method === 'GET' && (action === 'info' || action === undefined)) {
        const info = store.info(slug)
        return respond(res, info ? null : `Addon ${slug} does not exist`, info, 404)
    }
    if (method === 'GET' && action === 'logs') {
        sendText(res, 200, `[${slug}] mock add-on log line\n`)
        return true
    }
    if (method === 'POST' && action === 'install') {
        return respond(res, await store.install(slug), {})
    }
    const targetState = { start: 'started', stop: 'stopped', restart: 'started' }[action]
    if (method === 'POST' && targetState) {
        return respond(res, store.setState(slug, targetState), {})
    }
    return false
}

/**
 * @param {import('node:http').ServerResponse} res response
 * @param {string | null} error error message
 * @param {unknown} data success payload
 * @param {number} [errorStatus] HTTP status for errors
 * @returns {true} always handled
 */
function respond(res, error, data, errorStatus = 400) {
    if (error) {
        sendSupervisorError(res, errorStatus, error)
    } else {
        sendOk(res, data)
    }
    return true
}
