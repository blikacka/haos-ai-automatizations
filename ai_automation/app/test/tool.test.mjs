/**
 * Tests of the haos-tool CLI (compiled output in dist/tool). Run `npm run build:server` first.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
    describe,
    it,
} from 'node:test'
import {
    ToolError,
    getIntOption,
    parseArgs,
    parseJsonObject,
} from '../dist/tool/cli.js'
import {
    matchesSearch,
    normalizeSearchText,
} from '../dist/tool/search.js'
import {
    normalizeCheckResult,
    resolveReloadService,
} from '../dist/tool/reloadMap.js'
import {
    assertApiPath,
    isValidEntityId,
    parseRawMethod,
    parseServiceRef,
} from '../dist/tool/validation.js'
import {
    assertServiceAllowed,
    assertSupervisorRequestAllowed,
    assertWsMessageAllowed,
} from '../dist/tool/safety.js'
import {
    buildEntityRows,
    filterEntityRows,
} from '../dist/tool/entityIndex.js'
import { selectLogLines } from '../dist/tool/logText.js'
import {
    parseLsusb,
    usbHint,
} from '../dist/tool/serialDevices.js'
import { runCli } from '../dist/tool/runner.js'
import { redactSecret } from '../dist/tool/rawHttp.js'

const execFileAsync = promisify(execFile)
const toolPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'tool', 'haos-tool.js')

describe('parseArgs', () => {
    it('parses command, positionals and options', () => {
        const args = parseArgs(['entities', '--domain', 'light', '--search=kotelna', 'extra'])
        assert.equal(args.command, 'entities')
        assert.deepEqual(args.positionals, ['extra'])
        assert.deepEqual(args.options, { domain: 'light', search: 'kotelna' })
    })
    it('defaults to help and supports boolean flags and --', () => {
        assert.equal(parseArgs([]).command, 'help')
        const args = parseArgs(['call', 'light.turn_on', '--return-response', '--', '--raw'])
        assert.equal(args.options['return-response'], true)
        assert.deepEqual(args.positionals, ['light.turn_on', '--raw'])
    })
    it('rejects missing values and duplicates', () => {
        assert.throws(() => parseArgs(['logs', '--lines']), ToolError)
        assert.throws(() => parseArgs(['logs', '--grep', 'a', '--grep', 'b']), ToolError)
        assert.throws(() => parseArgs(['logs', '--Bad!']), ToolError)
    })
    it('validates integer options and JSON objects', () => {
        assert.equal(getIntOption(parseArgs(['logs', '--lines', '50']), 'lines', 200, 1, 5000), 50)
        assert.equal(getIntOption(parseArgs(['logs']), 'lines', 200, 1, 5000), 200)
        assert.throws(() => getIntOption(parseArgs(['logs', '--lines', '-5x']), 'lines', 200, 1, 5000), ToolError)
        assert.throws(() => getIntOption(parseArgs(['logs', '--lines', '9999']), 'lines', 200, 1, 5000), ToolError)
        assert.deepEqual(parseJsonObject('{"a":1}', 'x'), { a: 1 })
        assert.deepEqual(parseJsonObject(undefined, 'x'), {})
        assert.throws(() => parseJsonObject('[1]', 'x'), ToolError)
        assert.throws(() => parseJsonObject('{bad', 'x'), ToolError)
    })
})

describe('search normalization', () => {
    it('strips diacritics and case', () => {
        assert.equal(normalizeSearchText('  Světlo   KOTELNA '), 'svetlo kotelna')
        assert.equal(normalizeSearchText('Žluťoučký kůň'), 'zlutoucky kun')
    })
    it('requires every word to match some field', () => {
        assert.ok(matchesSearch('svetlo kotel', ['light.x', 'Světlo', 'Kotelna']))
        assert.ok(!matchesSearch('svetlo garaz', ['light.x', 'Světlo', 'Kotelna']))
        assert.ok(matchesSearch('', [null]))
    })
})

describe('entity rows', () => {
    const snapshot = {
        states: [
            { entity_id: 'switch.relay_1', state: 'off', attributes: { friendly_name: 'Světlo kotelna' } },
            { entity_id: 'light.kitchen', state: 'on', attributes: {} },
        ],
        entities: [
            { entity_id: 'switch.relay_1', device_id: 'dev1', area_id: null, name: null, platform: 'modbus', disabled_by: null },
            { entity_id: 'light.kitchen', device_id: null, area_id: 'kitchen', name: 'Kuchyň', platform: 'hue', disabled_by: null },
        ],
        devices: [{ id: 'dev1', name: 'Relay', name_by_user: 'Relé 16CH', area_id: 'boiler', manufacturer: null, model: null }],
        areas: [{ area_id: 'boiler', name: 'Kotelna' }, { area_id: 'kitchen', name: 'Kuchyň' }],
    }
    it('joins registries and filters', () => {
        const rows = buildEntityRows(snapshot)
        assert.deepEqual(rows[1], {
            entity_id: 'switch.relay_1', name: 'Světlo kotelna', state: 'off', area: 'Kotelna', device: 'Relé 16CH', domain: 'switch',
        })
        assert.equal(rows[0].name, 'Kuchyň')
        assert.equal(filterEntityRows(rows, { domain: null, search: 'rele', area: null }).length, 1)
        assert.equal(filterEntityRows(rows, { domain: 'light', search: null, area: null }).length, 1)
        assert.equal(filterEntityRows(rows, { domain: null, search: null, area: 'kuchyn' }, snapshot.areas)[0].entity_id, 'light.kitchen')
    })
})

describe('reload mapping and check result', () => {
    it('maps targets to services', () => {
        assert.deepEqual(resolveReloadService('automation'), { domain: 'automation', service: 'reload' })
        assert.deepEqual(resolveReloadService('input_boolean'), { domain: 'input_boolean', service: 'reload' })
        assert.deepEqual(resolveReloadService('core'), { domain: 'homeassistant', service: 'reload_core_config' })
        assert.deepEqual(resolveReloadService('all'), { domain: 'homeassistant', service: 'reload_all' })
        assert.throws(() => resolveReloadService('../x'), ToolError)
        assert.throws(() => resolveReloadService('Automation'), ToolError)
    })
    it('normalizes check_config', () => {
        assert.deepEqual(normalizeCheckResult({ result: 'valid', errors: null }), { valid: true, errors: null, warnings: null })
        assert.equal(normalizeCheckResult({ result: 'invalid', errors: 'bad' }).valid, false)
        assert.equal(normalizeCheckResult('garbage').valid, false)
    })
})

describe('validation and safety', () => {
    it('validates entity ids, services, methods and paths', () => {
        assert.ok(isValidEntityId('light.kitchen_1'))
        assert.ok(!isValidEntityId('light.Kitchen'))
        assert.ok(!isValidEntityId('light/../x'))
        assert.deepEqual(parseServiceRef('light.turn_on'), { domain: 'light', service: 'turn_on' })
        assert.throws(() => parseServiceRef('light.turn_on.x'), ToolError)
        assert.throws(() => parseServiceRef('light/turn_on'), ToolError)
        assert.equal(parseRawMethod('get'), 'GET')
        assert.throws(() => parseRawMethod('DELETE'), ToolError)
        assert.equal(assertApiPath('/api/states/light.kitchen'), '/api/states/light.kitchen')
        assert.throws(() => assertApiPath('api/config'), ToolError)
        assert.throws(() => assertApiPath('/api/../x'), ToolError)
        assert.throws(() => assertApiPath('//evil.example/x'), ToolError)
        assert.throws(() => assertApiPath('/api/x y'), ToolError)
    })
    it('blocks dangerous operations', () => {
        assert.throws(() => assertServiceAllowed('homeassistant', 'restart'), ToolError)
        assert.throws(() => assertServiceAllowed('hassio', 'host_reboot'), ToolError)
        assert.doesNotThrow(() => assertServiceAllowed('light', 'turn_on'))
        assert.throws(() => assertSupervisorRequestAllowed('POST', '/host/reboot'), ToolError)
        assert.throws(() => assertSupervisorRequestAllowed('POST', '/core/restart'), ToolError)
        assert.throws(() => assertSupervisorRequestAllowed('POST', '/addons/core_ssh/stop'), ToolError)
        assert.doesNotThrow(() => assertSupervisorRequestAllowed('GET', '/host/info'))
        assert.throws(() => assertWsMessageAllowed({ type: 'call_service', domain: 'homeassistant', service: 'stop' }), ToolError)
        assert.throws(() => assertWsMessageAllowed({}), ToolError)
        assert.doesNotThrow(() => assertWsMessageAllowed({ type: 'get_states' }))
    })
    it('redacts secrets', () => {
        assert.equal(redactSecret('token abc123 here', 'abc123'), 'token *** here')
    })
})

describe('logs and usb helpers', () => {
    it('tails and greps logs', () => {
        const text = '\u001b[32mline one modbus\u001b[0m\nline two\nline three Modbus\n'
        assert.equal(selectLogLines(text, 2, null), 'line two\nline three Modbus')
        assert.equal(selectLogLines(text, 10, 'MODBUS'), 'line one modbus\nline three Modbus')
    })
    it('parses lsusb and gives hints', () => {
        const entries = parseLsusb('Bus 001 Device 004: ID 1a86:7523 QinHeng Electronics CH340 serial converter\ngarbage')
        assert.deepEqual(entries, [{ bus: '001', device: '004', id: '1a86:7523', description: 'QinHeng Electronics CH340 serial converter' }])
        assert.match(usbHint('1A86', '7523'), /Waveshare/)
        assert.match(usbHint('0403', '6001'), /FT232/)
        assert.match(usbHint('10c4', 'ea60'), /CP210x/)
        assert.equal(usbHint('dead', 'beef'), null)
    })
})

describe('runner', () => {
    const collect = () => {
        const out = { stdout: [], stderr: [] }
        return { out, io: { stdout: (text) => out.stdout.push(text), stderr: (text) => out.stderr.push(text) } }
    }
    it('prints help without creating a context', async () => {
        const { out, io } = collect()
        const code = await runCli(['help'], { commands: new Map(), createContext: () => { throw new Error('no') }, io })
        assert.equal(code, 0)
        assert.match(out.stdout[0], /haos-tool entities/)
    })
    it('reports unknown commands and command exit codes', async () => {
        const { out, io } = collect()
        const commands = new Map([['check-config', async () => ({ output: { valid: false }, exitCode: 2 })]])
        assert.equal(await runCli(['nope'], { commands, createContext: () => ({}), io }), 1)
        assert.match(out.stderr[0], /Unknown command/)
        assert.equal(await runCli(['check-config'], { commands, createContext: () => ({}), io }), 2)
        assert.deepEqual(JSON.parse(out.stdout[0]), { valid: false })
    })
})

describe('haos-tool against a fake supervisor', () => {
    const startServer = async (checkResult) => {
        const calls = []
        const server = http.createServer((request, response) => {
            calls.push(`${request.method} ${request.url} ${request.headers.authorization}`)
            response.setHeader('Content-Type', 'application/json')
            if (request.url === '/core/api/config/core/check_config') {
                response.end(JSON.stringify(checkResult))
                return
            }
            response.end(JSON.stringify({ result: 'ok', data: {} }))
        })
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
        return { server, calls, url: `http://127.0.0.1:${server.address().port}` }
    }
    const runTool = async (url, args) => execFileAsync(process.execPath, [toolPath, ...args], {
        env: { ...process.env, SUPERVISOR_URL: url, SUPERVISOR_TOKEN: 'test-secret-token' },
    }).then((result) => ({ code: 0, ...result }), (error) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }))

    it('refuses reload and restart when config is invalid', async () => {
        const fake = await startServer({ result: 'invalid', errors: 'Invalid config for [modbus]' })
        try {
            const check = await runTool(fake.url, ['check-config'])
            assert.equal(check.code, 2)
            assert.deepEqual(JSON.parse(check.stdout), { valid: false, errors: 'Invalid config for [modbus]', warnings: null })
            assert.equal((await runTool(fake.url, ['reload', 'automation'])).code, 2)
            assert.equal((await runTool(fake.url, ['restart-core'])).code, 1)
            assert.ok(!fake.calls.some((call) => call.includes('/core/restart') || call.includes('/reload')))
            assert.ok(fake.calls.every((call) => call.endsWith('Bearer test-secret-token')))
        } finally {
            fake.server.close()
        }
    })
    it('reloads and restarts when config is valid; blocks dangerous calls', async () => {
        const fake = await startServer({ result: 'valid', errors: null })
        try {
            const reload = await runTool(fake.url, ['reload', 'automation'])
            assert.equal(reload.code, 0)
            assert.ok(fake.calls.some((call) => call.startsWith('POST /core/api/services/automation/reload ')))
            assert.equal((await runTool(fake.url, ['restart-core'])).code, 0)
            assert.ok(fake.calls.some((call) => call.startsWith('POST /core/restart ')))
            const blocked = await runTool(fake.url, ['call', 'homeassistant.restart'])
            assert.equal(blocked.code, 1)
            assert.ok(!blocked.stderr.includes('test-secret-token'))
        } finally {
            fake.server.close()
        }
    })
})
