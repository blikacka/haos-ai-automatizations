/**
 * Turn simulation of the fake Codex app-server (see fake-codex.mjs for the keyword list).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const REPAIR_MARKER = 'Automatická kontrola konfigurace selhala'
const STEP_MS = Number(process.env.FAKE_CODEX_STEP_MS ?? 10)
const newId = () => randomUUID()
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let notify = () => {}
let askClient = () => Promise.reject(new Error('not configured'))

/**
 * Wires the transport functions of the fake server.
 *
 * @param transport {notify(method, params), askClient(method, params): Promise}
 */
export function configureTurns(transport) {
    notify = transport.notify
    askClient = transport.askClient
}

export function turnObject(turn, status) {
    return { id: turn.id, items: [], itemsView: 'notLoaded', status, error: null, startedAt: null, completedAt: null, durationMs: null }
}

async function emitItem(thread, turn, item, startedItem = null) {
    const base = { threadId: thread.id, turnId: turn.id }
    notify('item/started', { ...base, item: startedItem ?? item, startedAtMs: Date.now() })
    await sleep(STEP_MS)
    notify('item/completed', { ...base, item, completedAtMs: Date.now() })
}

function fileChangeItem(thread, before, after) {
    const path = join(thread.cwd, 'automations.yaml')
    const diff = `--- a/automations.yaml\n+++ b/automations.yaml\n-${before.split('\n').join('\n-')}\n+${after.split('\n').join('\n+')}\n`
    return { type: 'fileChange', id: newId(), status: 'completed', changes: [{ path, kind: before === '' ? { type: 'add' } : { type: 'update', move_path: null }, diff }] }
}

function automationYaml() {
    const suffix = Date.now().toString(36)
    return `- id: 'fake_boiler_${suffix}'\n  alias: Ranní zapnutí kotle\n  description: Vytvořeno falešným Codexem pro testy\n`
        + '  triggers:\n    - trigger: time\n      at: "06:30:00"\n  conditions: []\n  actions:\n'
        + '    - action: switch.turn_on\n      target:\n        entity_id: switch.kotel\n  mode: single\n'
}

async function editAutomations(thread, turn, transform) {
    const path = join(thread.cwd, 'automations.yaml')
    const before = existsSync(path) ? readFileSync(path, 'utf8') : ''
    const after = transform(before)
    writeFileSync(path, after)
    await emitItem(thread, turn, fileChangeItem(thread, before, after))
    return before
}

async function applyPromptEffects(thread, turn, prompt) {
    if (prompt.includes(REPAIR_MARKER)) {
        if (thread.backup !== null && !thread.lastPrompt.includes('rozbij-trvale')) {
            const backup = thread.backup
            await editAutomations(thread, turn, () => backup)
            thread.backup = null
            return 'Opravil jsem chybu v automations.yaml.'
        }
        return 'Chybu se mi opravit nepodařilo.'
    }
    thread.lastPrompt = prompt
    if (prompt.includes('rozbij')) {
        thread.backup = await editAutomations(thread, turn, (before) => `${before}\n- id: broken\n  alias: [neuzavřeno\n  triggers: : :\n`)
        return 'Upravil jsem automations.yaml.'
    }
    if (prompt.includes('automatizace')) {
        await editAutomations(thread, turn, (before) => {
            const current = before.trim() === '[]' ? '' : before
            return `${current}${current === '' || current.endsWith('\n') ? '' : '\n'}${automationYaml()}`
        })
        return 'Přidal jsem automatizaci „Ranní zapnutí kotle“.'
    }
    return 'Hotovo.'
}

async function askQuestion(thread, turn) {
    const itemId = newId()
    const answer = askClient('item/tool/requestUserInput', {
        threadId: thread.id, turnId: turn.id, itemId, isBlocking: true, autoResolutionMs: null,
        questions: [{
            id: 'boiler', header: 'Kotel', question: 'Který kotel myslíte?', isOther: true, isSecret: false,
            options: [{ label: 'switch.kotel', description: 'Kotel (Kotelna)' }, { label: 'switch.kotel_2', description: 'Kotel 2 (Garáž)' }],
        }],
    })
    const interrupted = new Promise((resolve) => { turn.finish = () => resolve(null) })
    const response = await Promise.race([answer, interrupted])
    return response?.answers?.boiler?.answers?.join(', ') ?? null
}

export async function runTurn(thread, turn, prompt) {
    const base = { threadId: thread.id, turnId: turn.id }
    notify('turn/started', { threadId: thread.id, turn: turnObject(turn, 'inProgress') })
    try {
        await sleep(STEP_MS)
        await emitItem(thread, turn, { type: 'reasoning', id: newId(), summary: ['Zjišťuji, co uživatel potřebuje.'], content: [] })
        const command = { type: 'commandExecution', id: newId(), command: "/bin/bash -lc 'haos-tool entities --search kotel'", cwd: thread.cwd,
            processId: null, source: 'agent', status: 'inProgress', commandActions: [{ type: 'unknown', command: 'haos-tool entities --search kotel' }],
            aggregatedOutput: null, exitCode: null, durationMs: null, pluginId: null, scriptPath: null }
        const output = JSON.stringify([{ entity_id: 'switch.kotel', state: 'off', friendly_name: 'Kotel', area: 'Kotelna' }], null, 2)
        await emitItem(thread, turn, { ...command, status: 'completed', aggregatedOutput: output, exitCode: 0, durationMs: 12 }, command)
        let chosen = null
        if (prompt.includes('otázka') && !turn.interrupted) {
            chosen = await askQuestion(thread, turn)
        }
        const summary = turn.interrupted ? '' : await applyPromptEffects(thread, turn, prompt)
        if (!turn.interrupted) {
            const text = chosen === null ? summary : `Vybral jste ${chosen}. ${summary}`
            const messageId = newId()
            notify('item/started', { ...base, item: { type: 'agentMessage', id: messageId, text: '', phase: null }, startedAtMs: Date.now() })
            for (const delta of text.match(/.{1,12}/gsu) ?? []) {
                notify('item/agentMessage/delta', { ...base, itemId: messageId, delta })
                await sleep(1)
            }
            notify('item/completed', { ...base, item: { type: 'agentMessage', id: messageId, text, phase: null }, completedAtMs: Date.now() })
        }
    } catch (error) {
        notify('error', { error: { message: String(error?.message ?? error) }, willRetry: false, ...base })
    }
    thread.turn = null
    notify('turn/completed', { threadId: thread.id, turn: turnObject(turn, turn.interrupted ? 'interrupted' : 'completed') })
}
