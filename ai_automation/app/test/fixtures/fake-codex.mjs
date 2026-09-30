#!/usr/bin/env node
/**
 * Fake `codex app-server` for tests and local development (never contacts any remote system).
 * Protocol: newline-delimited JSON-RPC over stdio without the "jsonrpc" field, like the real app-server.
 *
 * Supported: initialize, account/read (logged out until a login completes; persisted in
 * $CODEX_HOME/fake-auth.json), account/login/start {type:'chatgptDeviceCode'} (completes after
 * FAKE_CODEX_LOGIN_DELAY_MS, default 1500 ms), account/login/cancel, account/logout, model/list
 * (one model per page unless `limit` is given), thread/start, thread/resume, turn/start, turn/interrupt.
 *
 * turn/start prompt keywords:
 *   'automatizace'  appends a valid automation to <cwd>/automations.yaml and emits a fileChange item
 *   'rozbij'        writes invalid YAML to automations.yaml; the following repair prompt (containing
 *                   'Automatická kontrola konfigurace selhala') fixes it, unless the original prompt
 *                   contained 'rozbij-trvale'
 *   'otázka'        sends item/tool/requestUserInput and waits for the answer
 * Test helpers: fake/garbage (invalid + split lines), fake/sleep (never answers), fake/exit (exits 3),
 * fake/askClient {method} (sends a server request to the client and returns its reply).
 * Env: FAKE_CODEX_STEP_MS (delay between turn steps, default 10). Turn simulation: fake-codex-turn.mjs.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { configureTurns, runTurn, turnObject } from './fake-codex-turn.mjs'

const LOGIN_DELAY_MS = Number(process.env.FAKE_CODEX_LOGIN_DELAY_MS ?? 1500)
const CODEX_HOME = process.env.CODEX_HOME ?? process.cwd()
const AUTH_FILE = join(CODEX_HOME, 'fake-auth.json')
const MODELS = [
    model('gpt-5.5-codex', 'GPT-5.5 Codex', true, ['low', 'medium', 'high', 'xhigh'], 'medium'),
    model('gpt-5.4-mini', 'GPT-5.4 mini', false, ['low', 'medium', 'high'], 'low'),
    { ...model('gpt-internal', 'Internal', false, ['low'], 'low'), hidden: true },
]

const threads = new Map()
const clientRequests = new Map()
let initialized = false
let nextServerRequestId = 1
let pendingLogin = null

function model(id, displayName, isDefault, efforts, defaultEffort) {
    return {
        id, model: id, displayName, description: `${displayName} (fake)`, hidden: false, isDefault,
        supportedReasoningEfforts: efforts.map((effort) => ({ reasoningEffort: effort, description: `Effort ${effort}` })),
        defaultReasoningEffort: defaultEffort, upgrade: null, inputModalities: ['text'],
    }
}

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
const notify = (method, params) => send({ method, params })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const newId = () => randomUUID()

function askClient(method, params) {
    const id = `srv-${nextServerRequestId++}`
    send({ id, method, params })
    return new Promise((resolve, reject) => clientRequests.set(id, { resolve, reject }))
}

function readAuth() {
    try {
        return JSON.parse(readFileSync(AUTH_FILE, 'utf8'))
    } catch {
        return null
    }
}

function accountRead() {
    const auth = readAuth()
    return { account: auth === null ? null : { type: 'chatgpt', email: auth.email, planType: auth.planType }, requiresOpenaiAuth: true }
}

function loginStart(params) {
    if (params?.type !== 'chatgptDeviceCode') {
        throw rpcError(-32602, 'Only chatgptDeviceCode is supported by the fake')
    }
    if (pendingLogin !== null) {
        clearTimeout(pendingLogin.timer)
    }
    const loginId = newId()
    const timer = setTimeout(() => {
        pendingLogin = null
        writeFileSync(AUTH_FILE, JSON.stringify({ email: 'fake.user@example.com', planType: 'plus' }), { mode: 0o600 })
        notify('account/login/completed', { loginId, success: true, error: null, onboardingEntrypoint: null })
        notify('account/updated', { authMode: 'chatgpt', planType: 'plus' })
    }, LOGIN_DELAY_MS)
    pendingLogin = { loginId, timer }
    return { type: 'chatgptDeviceCode', loginId, verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-1234' }
}

function loginCancel(params) {
    if (pendingLogin === null || pendingLogin.loginId !== params?.loginId) {
        return { status: 'notFound' }
    }
    clearTimeout(pendingLogin.timer)
    pendingLogin = null
    return { status: 'canceled' }
}

function logout() {
    rmSync(AUTH_FILE, { force: true })
    notify('account/updated', { authMode: null, planType: null })
    return {}
}

function modelList(params) {
    const visible = MODELS.filter((entry) => params?.includeHidden === true || !entry.hidden)
    const start = Number(params?.cursor ?? 0)
    const limit = Number(params?.limit ?? 1)
    const end = start + limit
    return { data: visible.slice(start, end), nextCursor: end < visible.length ? String(end) : null }
}

function threadResponse(thread) {
    return {
        thread: { id: thread.id, preview: '', cwd: thread.cwd, turns: [] },
        model: thread.model, modelProvider: 'openai', serviceTier: null, cwd: thread.cwd, instructionSources: [],
        approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: { type: 'dangerFullAccess' }, reasoningEffort: null,
    }
}

function threadOpen(params, resume) {
    const id = resume ? String(params?.threadId ?? '') : newId()
    if (id === '') {
        throw rpcError(-32602, 'threadId is required')
    }
    const thread = threads.get(id) ?? { id, cwd: process.cwd(), model: 'gpt-5.5-codex', lastPrompt: '', backup: null, turn: null }
    thread.cwd = params?.cwd ?? thread.cwd
    thread.model = params?.model ?? thread.model
    threads.set(id, thread)
    if (!resume) {
        notify('thread/started', { thread: { id, preview: '', cwd: thread.cwd, turns: [] } })
    }
    return threadResponse(thread)
}

function turnStart(params) {
    const thread = threads.get(params?.threadId)
    if (thread === undefined) {
        throw rpcError(-32600, `thread not found: ${params?.threadId}`)
    }
    if (thread.turn !== null) {
        throw rpcError(-32600, 'a turn is already running')
    }
    const prompt = (params?.input ?? []).map((input) => (input?.type === 'text' ? input.text : '')).join('\n')
    const turn = { id: newId(), interrupted: false, finish: null }
    thread.turn = turn
    setImmediate(() => void runTurn(thread, turn, prompt))
    return { turn: turnObject(turn, 'inProgress') }
}

function turnInterrupt(params) {
    const thread = threads.get(params?.threadId)
    const turn = thread?.turn
    if (turn === null || turn === undefined || turn.id !== params?.turnId) {
        throw rpcError(-32600, 'no such running turn')
    }
    turn.interrupted = true
    turn.finish?.()
    return {}
}

function rpcError(code, message) {
    return Object.assign(new Error(message), { rpcCode: code })
}

const HANDLERS = {
    'account/read': accountRead,
    'account/login/start': loginStart,
    'account/login/cancel': loginCancel,
    'account/logout': logout,
    'model/list': modelList,
    'thread/start': (params) => threadOpen(params, false),
    'thread/resume': (params) => threadOpen(params, true),
    'turn/start': turnStart,
    'turn/interrupt': turnInterrupt,
    'fake/askClient': (params) => askClient(params?.method ?? 'fake/unknown', params?.params ?? {}).then((result) => ({ result }), (error) => ({ error })),
    'fake/sleep': () => new Promise(() => {}),
    'fake/exit': () => {
        setTimeout(() => process.exit(3), 5)
        return { exiting: true }
    },
    'fake/garbage': async () => {
        process.stdout.write('this is not json\n[1,2]\n')
        await sleep(5)
        return { garbage: true }
    },
}

async function handleRequest(message) {
    try {
        if (message.method === 'initialize') {
            initialized = true
            return send({ id: message.id, result: { userAgent: 'fake-codex/0.0.0', codexHome: CODEX_HOME, platformFamily: 'unix', platformOs: 'linux' } })
        }
        if (!initialized) {
            throw rpcError(-32002, 'Not initialized')
        }
        const handler = HANDLERS[message.method]
        if (handler === undefined) {
            throw rpcError(-32601, `Method not found: ${message.method}`)
        }
        const result = await handler(message.params)
        if (message.method === 'fake/garbage') {
            const text = JSON.stringify({ id: message.id, result })
            process.stdout.write(text.slice(0, 7))
            await sleep(20)
            return process.stdout.write(`${text.slice(7)}\n`)
        }
        return send({ id: message.id, result: result ?? {} })
    } catch (error) {
        return send({ id: message.id, error: { code: error.rpcCode ?? -32603, message: error.message } })
    }
}

function handleLine(line) {
    let message
    try {
        message = JSON.parse(line)
    } catch {
        process.stderr.write(`fake-codex: invalid line ${line.slice(0, 80)}\n`)
        return
    }
    if (message.method !== undefined && message.id !== undefined) {
        void handleRequest(message)
    } else if (message.id !== undefined && clientRequests.has(message.id)) {
        const pending = clientRequests.get(message.id)
        clientRequests.delete(message.id)
        if (message.error !== undefined) {
            pending.reject(message.error)
        } else {
            pending.resolve(message.result)
        }
    }
}

configureTurns({ notify, askClient })
process.stderr.write(`fake-codex: started (CODEX_HOME=${CODEX_HOME})\n`)
createInterface({ input: process.stdin }).on('line', handleLine).on('close', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
