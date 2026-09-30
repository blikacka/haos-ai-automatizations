#!/usr/bin/env node
/**
 * Self-test of the mock Supervisor: runs against a COPY of seed-config in <repo>/tmp.
 * Usage: node devtools/test-mock.mjs
 */
import assert from 'node:assert/strict'
import {
    appendFileSync,
    cpSync,
    mkdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import { startMockSupervisor } from './mock-supervisor.mjs'
import { WebSocket } from './mock/wsLib.mjs'

const TOKEN = 'dev-supervisor-token'
const seedDir = fileURLToPath(new URL('./seed-config', import.meta.url))
const minimalSeedDir = fileURLToPath(new URL('./seed-config-minimal', import.meta.url))
const workDir = fileURLToPath(new URL(`../tmp/mock-test-${process.pid}`, import.meta.url))
const configDir = `${workDir}/config`
const results = []

/**
 * @param {string} name test name
 * @param {() => Promise<void>} body test body
 */
async function check(name, body) {
    try {
        await body()
        results.push(`PASS ${name}`)
    } catch (error) {
        results.push(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
}

mkdirSync(workDir, { recursive: true })
cpSync(seedDir, configDir, { recursive: true })
writeFileSync(`${configDir}/secrets.yaml`, 'recorder_db_url: "sqlite:///fake-dev.db"\n')
const mock = await startMockSupervisor({ configDir, port: 0 })
const base = `http://127.0.0.1:${mock.port}`
const api = async (method, path, body, token = TOKEN) => {
    const response = await fetch(`${base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    const contentType = response.headers.get('content-type') ?? ''
    return { status: response.status, body: contentType.includes('json') ? JSON.parse(text) : text }
}

/**
 * Opens an authenticated WS and sends commands sequentially.
 *
 * @param {Record<string, unknown>[]} commands commands without id
 * @returns {Promise<Record<string, unknown>[]>} result messages
 */
function wsCommands(commands) {
    return new Promise((resolveResults, rejectResults) => {
        const socket = new WebSocket(`ws://127.0.0.1:${mock.port}/core/websocket`)
        const collected = []
        socket.on('message', (raw) => {
            const message = JSON.parse(raw.toString())
            if (message.type === 'auth_required') {
                socket.send(JSON.stringify({ type: 'auth', access_token: TOKEN }))
            } else if (message.type === 'auth_ok') {
                commands.forEach((command, index) => socket.send(JSON.stringify({ id: index + 1, ...command })))
            } else if (message.type === 'result') {
                collected.push(message)
                if (collected.length === commands.length) {
                    socket.close()
                    resolveResults(collected.sort((left, right) => left.id - right.id))
                }
            }
        })
        socket.on('error', rejectResults)
    })
}

await check('rejects missing token', async () => {
    assert.equal((await api('GET', '/info', undefined, 'wrong')).status, 401)
})
await check('supervisor envelope /info + hardware USB', async () => {
    assert.equal((await api('GET', '/info')).body.result, 'ok')
    const hardware = (await api('GET', '/hardware/info')).body.data
    const usb = hardware.devices.find((device) => device.dev_path === '/dev/ttyUSB0')
    assert.equal(usb.by_id, '/dev/serial/by-id/usb-1a86_USB_Serial-if00-port0')
    assert.equal(usb.attributes.ID_MODEL_ID, '7523')
})
await check('check_config valid on seed', async () => {
    const { body } = await api('POST', '/core/api/config/core/check_config')
    assert.deepEqual(body, { result: 'valid', errors: null })
})
await check('states contain seed + automation', async () => {
    const states = (await api('GET', '/core/api/states')).body
    const lamp = states.find((state) => state.entity_id === 'light.kotelna_zarovka')
    assert.equal(lamp.attributes.friendly_name, 'Žárovka kotelna')
    assert.ok(states.some((state) => state.entity_id === 'automation.rozsvitit_chodbu_pri_otevreni_dveri'))
})
await check('check_config invalid on YAML syntax error', async () => {
    writeFileSync(`${configDir}/packages/broken.yaml`, 'sensor:\n  - platform: template\n    bad: [unclosed\n')
    const { body } = await api('POST', '/core/api/config/core/check_config')
    assert.equal(body.result, 'invalid')
    assert.match(body.errors, /packages\/broken\.yaml/)
    rmSync(`${configDir}/packages/broken.yaml`)
})
await check('check_config invalid on automation without actions', async () => {
    appendFileSync(`${configDir}/automations.yaml`, "- id: '2'\n  alias: Rozbitá\n  triggers:\n    - trigger: state\n      entity_id: light.chodba\n")
    const { body } = await api('POST', '/core/api/config/core/check_config')
    assert.equal(body.result, 'invalid')
    assert.match(body.errors, /required key 'actions'/)
})
await check('check_config invalid on missing secret / include', async () => {
    cpSync(`${seedDir}/automations.yaml`, `${configDir}/automations.yaml`)
    appendFileSync(`${configDir}/configuration.yaml`, 'mqtt: !secret nonexistent_secret\nsensor: !include missing.yaml\n')
    const { body } = await api('POST', '/core/api/config/core/check_config')
    assert.equal(body.result, 'invalid')
    assert.match(body.errors, /Secret nonexistent_secret not defined/)
    assert.match(body.errors, /missing\.yaml/)
    cpSync(`${seedDir}/configuration.yaml`, `${configDir}/configuration.yaml`)
})
await check('automation.reload picks up new automation', async () => {
    appendFileSync(`${configDir}/automations.yaml`, "- id: '3'\n  alias: Zhasnout kotelnu v noci\n  triggers:\n    - trigger: time\n      at: '23:00:00'\n  actions:\n    - action: light.turn_off\n      target:\n        entity_id: light.kotelna_zarovka\n")
    assert.equal((await api('POST', '/core/api/services/automation/reload', {})).status, 200)
    const state = (await api('GET', '/core/api/states/automation.zhasnout_kotelnu_v_noci')).body
    assert.equal(state.state, 'on')
})
await check('websocket commands', async () => {
    const [states, entities, display, devices, areas, services, traces, call] = await wsCommands([
        { type: 'get_states' },
        { type: 'config/entity_registry/list' },
        { type: 'config/entity_registry/list_for_display' },
        { type: 'config/device_registry/list' },
        { type: 'config/area_registry/list' },
        { type: 'get_services' },
        { type: 'trace/list', domain: 'automation', item_id: '1727712000000' },
        { type: 'call_service', domain: 'light', service: 'turn_on', service_data: {}, target: { entity_id: 'light.kotelna_zarovka' } },
    ])
    assert.ok(states.result.length > 10)
    assert.equal(entities.result.find((entry) => entry.entity_id === 'light.kotelna_zarovka').area_id, 'kotelna')
    assert.ok(display.result.entities.length > 10)
    assert.ok(devices.result.length > 5)
    assert.deepEqual(areas.result.map((area) => area.name), ['Kotelna', 'Obývák', 'Kuchyně', 'Chodba', 'Garáž'])
    assert.ok(services.result.light.turn_on)
    assert.equal(traces.result.length, 1)
    assert.equal(call.success, true)
    assert.equal((await api('GET', '/core/api/states/light.kotelna_zarovka')).body.state, 'on')
})
await check('store install + repository add', async () => {
    assert.equal((await api('POST', '/store/repositories', { repository: 'https://github.com/zigbee2mqtt/hassio-zigbee2mqtt' })).status, 200)
    const store = (await api('GET', '/store')).body.data
    assert.ok(store.addons.some((addon) => addon.slug === '45df7312_zigbee2mqtt'))
    assert.equal((await api('POST', '/store/addons/core_mariadb/install')).status, 200)
    assert.equal((await api('POST', '/addons/core_mariadb/start')).status, 200)
    assert.equal((await api('GET', '/addons/core_mariadb/info')).body.data.state, 'started')
})
await check('backup + restart makes core 502 for ~2 s', async () => {
    assert.equal((await api('POST', '/backups/new/partial', { name: 'test', homeassistant: true })).body.result, 'ok')
    assert.equal((await api('POST', '/core/restart')).status, 200)
    assert.equal((await api('GET', '/core/api/config')).status, 502)
    await new Promise((resolveWait) => setTimeout(resolveWait, 2200))
    assert.equal((await api('GET', '/core/api/config')).status, 200)
})
await check('minimal seed (no includes) is valid', async () => {
    const minimal = await startMockSupervisor({ configDir: minimalSeedDir, port: 0 })
    try {
        const response = await fetch(`http://127.0.0.1:${minimal.port}/core/api/config/core/check_config`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } })
        assert.deepEqual(await response.json(), { result: 'valid', errors: null })
        assert.ok(minimal.context.home.states.has('automation.zapnout_cerpadlo_rano'))
    } finally {
        await minimal.close()
    }
})

await mock.close()
rmSync(workDir, { recursive: true, force: true })
console.log(results.join('\n'))
process.exit(results.some((line) => line.startsWith('FAIL')) ? 1 : 0)
