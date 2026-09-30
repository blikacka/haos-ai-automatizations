import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
    MAX_DETAIL_LENGTH,
    buildUserInputResponse,
    mapItemToEntry,
    mapRequestUserInput,
    unwrapShellCommand,
} from '../dist/server/codex/eventMapper.js'
import { mapModels } from '../dist/server/codex/modelService.js'
import { toAccountState } from '../dist/server/codex/accountService.js'

const DIR = '/homeassistant'
const AT = '2026-09-30T12:00:00.000Z'

function command(overrides) {
    return {
        type: 'commandExecution', id: 'c1', command: "/bin/bash -lc 'cat automations.yaml'", cwd: DIR,
        status: 'completed', commandActions: [], aggregatedOutput: 'ok', exitCode: 0, ...overrides,
    }
}

const map = (item) => mapItemToEntry(item, DIR, AT)

describe('eventMapper commands', () => {
    it('describes read / listFiles / search actions', () => {
        const read = map(command({ commandActions: [{ type: 'read', command: 'cat automations.yaml', name: 'automations.yaml', path: '/homeassistant/automations.yaml' }] }))
        assert.deepEqual([read.kind, read.activity, read.title, read.status], ['activity', 'read', 'Čtu soubor automations.yaml', 'done'])
        assert.equal(read.detail, '$ cat automations.yaml\nok')
        const list = map(command({ commandActions: [{ type: 'listFiles', command: 'ls packages', path: '/homeassistant/packages' }] }))
        assert.equal(list.title, 'Procházím složku packages')
        const search = map(command({ commandActions: [{ type: 'search', command: 'rg kotel', query: 'kotel', path: null }] }))
        assert.deepEqual([search.activity, search.title], ['search', 'Hledám „kotel“'])
    })
    it('gives haos-tool commands friendly titles', () => {
        const titles = {
            'haos-tool entities --search kotel': 'Zjišťuji entity',
            'haos-tool check-config': 'Kontroluji konfiguraci',
            'haos-tool reload automation': 'Načítám konfiguraci znovu',
            'haos-tool snapshot "před změnou"': 'Vytvářím zálohu',
            'haos-tool usb': 'Zjišťuji hardware',
            'haos-tool hardware': 'Zjišťuji hardware',
            'haos-tool logs core --lines 50': 'Čtu logy',
            'haos-tool call light.turn_on \'{"entity_id":"light.x"}\'': 'Volám službu light.turn_on',
            'haos-tool constructor': 'Spouštím haos-tool constructor',
        }
        for (const [text, title] of Object.entries(titles)) {
            assert.equal(map(command({ command: text, commandActions: [{ type: 'unknown', command: text }] })).title, title, text)
        }
        assert.equal(map(command({ command: "/bin/bash -lc 'haos-tool check-config'" })).title, 'Kontroluji konfiguraci')
    })
    it('previews unknown commands and maps statuses', () => {
        const long = `echo ${'x'.repeat(200)}`
        const entry = map(command({ command: long, commandActions: [{ type: 'unknown', command: long }] }))
        assert.ok(entry.title.startsWith('Spouštím příkaz: echo x'))
        assert.ok(entry.title.length <= 'Spouštím příkaz: '.length + 80)
        assert.equal(map(command({ status: 'inProgress', exitCode: null })).status, 'running')
        assert.equal(map(command({ status: 'declined' })).status, 'failed')
        const failed = map(command({ status: 'completed', exitCode: 2 }))
        assert.equal(failed.status, 'failed')
        assert.match(failed.detail, /kód ukončení 2/)
        const huge = map(command({ aggregatedOutput: 'y'.repeat(20000) }))
        assert.ok(huge.detail.length <= MAX_DETAIL_LENGTH)
        assert.equal(unwrapShellCommand('bash -lc "ls -la"'), 'ls -la')
    })
})

describe('eventMapper other items', () => {
    it('maps file changes with relative paths', () => {
        const entry = map({ type: 'fileChange', id: 'f1', status: 'completed', changes: [
            { path: '/homeassistant/automations.yaml', kind: { type: 'update', move_path: null }, diff: '@@' },
            { path: '/homeassistant/packages/modbus.yaml', kind: { type: 'add' }, diff: '+a' },
            { path: 'scripts.yaml', kind: { type: 'delete' }, diff: '-b' },
        ] })
        assert.deepEqual(entry, { id: 'f1', at: AT, kind: 'fileChange', files: [
            { path: 'automations.yaml', changeKind: 'update', diff: '@@' },
            { path: 'packages/modbus.yaml', changeKind: 'add', diff: '+a' },
            { path: 'scripts.yaml', changeKind: 'delete', diff: '-b' },
        ] })
        assert.equal(map({ type: 'fileChange', id: 'f2', status: 'completed', changes: [] }), null)
        const failed = map({ type: 'fileChange', id: 'f3', status: 'failed', changes: [{ path: '/etc/passwd', kind: { type: 'add' }, diff: '' }] })
        assert.deepEqual([failed.kind, failed.status, failed.detail], ['activity', 'failed', '/etc/passwd'])
    })
    it('maps messages, reasoning, plans, web and tool calls', () => {
        assert.deepEqual(map({ type: 'agentMessage', id: 'a1', text: 'Ahoj' }), { id: 'a1', at: AT, kind: 'assistant', text: 'Ahoj', streaming: false })
        const reasoning = map({ type: 'reasoning', id: 'r1', summary: ['Krok 1', 'Krok 2'], content: [] })
        assert.deepEqual([reasoning.activity, reasoning.title, reasoning.detail], ['reasoning', 'Přemýšlím', 'Krok 1\n\nKrok 2'])
        assert.equal(map({ type: 'plan', id: 'p1', text: '1. a' }).activity, 'plan')
        assert.equal(map({ type: 'webSearch', id: 'w1', query: 'modbus', action: null }).activity, 'web')
        const mcp = map({ type: 'mcpToolCall', id: 'm1', server: 'ha', tool: 'states', status: 'inProgress', arguments: { a: 1 } })
        assert.deepEqual([mcp.activity, mcp.status, mcp.title], ['tool', 'running', 'Používám nástroj ha/states'])
        assert.equal(map({ type: 'dynamicToolCall', id: 'd1', tool: 'x', status: 'completed', success: false, arguments: null }).status, 'failed')
    })
    it('ignores user messages and unknown shapes', () => {
        for (const value of [{ type: 'userMessage', id: 'u1', content: [] }, { type: 'contextCompaction', id: 'x' }, null, 'str', [], { type: 'agentMessage' }]) {
            assert.equal(map(value), null)
        }
    })
})

describe('user input and mapping helpers', () => {
    it('maps requestUserInput questions', () => {
        const questions = mapRequestUserInput({ threadId: 't', questions: [
            { id: 'q1', header: 'Kotel', question: 'Který?', isOther: false, isSecret: false, options: [{ label: 'A', description: 'a' }, { bad: true }] },
            { id: 'q2', header: '', question: 'Napište název', isOther: false, isSecret: false, options: null },
            { header: 'no id' },
        ] })
        assert.deepEqual(questions, [
            { id: 'q1', header: 'Kotel', question: 'Který?', allowOther: false, options: [{ label: 'A', description: 'a' }] },
            { id: 'q2', header: '', question: 'Napište název', allowOther: true, options: [] },
        ])
        assert.equal(mapRequestUserInput({ questions: [] }), null)
        assert.equal(mapRequestUserInput(null), null)
    })
    it('builds the answer payload', () => {
        assert.deepEqual(buildUserInputResponse({ q1: ['A'], q2: ['x', 'y'] }), { answers: { q1: { answers: ['A'] }, q2: { answers: ['x', 'y'] } } })
        const polluted = buildUserInputResponse(JSON.parse('{"__proto__": ["x"], "ok": ["1"]}'))
        assert.deepEqual(polluted, { answers: { ok: { answers: ['1'] } } })
    })
    it('maps models and accounts', () => {
        const models = mapModels([
            { id: 'a', model: 'a', displayName: 'A', description: 'd', hidden: false, isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'H' }] },
            { id: 'h', model: 'h', hidden: true },
            { id: 'a', model: 'a', hidden: false },
            { nothing: true },
        ])
        assert.deepEqual(models, [{ id: 'a', displayName: 'A', description: 'd', isDefault: true, efforts: [{ id: 'high', description: 'H' }], defaultEffort: 'high' }])
        assert.deepEqual(toAccountState({ account: null }), { status: 'loggedOut' })
        assert.deepEqual(toAccountState({ account: { type: 'chatgpt', email: 'e@x', planType: 'pro' } }), { status: 'loggedIn', email: 'e@x', planType: 'pro' })
        assert.deepEqual(toAccountState({ account: { type: 'apiKey' } }), { status: 'loggedIn', email: null, planType: null })
    })
})
