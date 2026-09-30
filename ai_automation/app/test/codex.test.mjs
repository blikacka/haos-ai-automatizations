import assert from 'node:assert/strict'
import {
    mkdir,
    mkdtemp,
    readFile,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { JsonRpcProcess } from '../dist/server/codex/rpcClient.js'
import {
    CodexSessionPool,
    DEFAULT_CODEX_CONFIG,
    buildCodexEnv,
    prepareCodexHome,
    userDataDir,
} from '../dist/server/codex/sessionPool.js'
import { AccountService } from '../dist/server/codex/accountService.js'
import { ModelService } from '../dist/server/codex/modelService.js'
import { setLogLevel } from '../dist/server/util/logger.js'
import {
    buildUserInputResponse,
    mapItemToEntry,
    mapRequestUserInput,
} from '../dist/server/codex/eventMapper.js'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const fakeCodex = join(appDir, 'test', 'fixtures', 'fake-codex.mjs')
const scratchRoot = join(appDir, '..', '..', 'tmp')
const USER = 'user-1'
let workDir = ''
let env = null

setLogLevel('error')
process.env.FAKE_CODEX_LOGIN_DELAY_MS = '150'
process.env.FAKE_CODEX_STEP_MS = '2'

function waitFor(emitter, event, predicate = () => true, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs)
        const listener = (...args) => {
            if (predicate(...args)) {
                clearTimeout(timer)
                emitter.off(event, listener)
                resolve(args)
            }
        }
        emitter.on(event, listener)
    })
}

function collectTurn(session, threadId) {
    const notifications = []
    const done = waitFor(session, 'notification', (method, params) => {
        notifications.push({ method, params })
        return method === 'turn/completed' && params.threadId === threadId
    })
    return done.then(() => notifications)
}

async function runTurn(session, text) {
    const { thread } = await session.request('thread/start', { cwd: env.haConfigDir, approvalPolicy: 'never' })
    const collected = collectTurn(session, thread.id)
    const started = await session.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text, text_elements: [] }] })
    return { thread, turn: started.turn, notifications: collected }
}

function entriesOf(notifications) {
    return notifications
        .filter((note) => note.method === 'item/completed')
        .map((note) => mapItemToEntry(note.params.item, env.haConfigDir, 'now'))
        .filter((entry) => entry !== null)
}

before(async () => {
    await mkdir(scratchRoot, { recursive: true })
    workDir = await mkdtemp(join(scratchRoot, 'codex-test-'))
    env = {
        port: 0, haConfigDir: join(workDir, 'config'), dataDir: join(workDir, 'data'), supervisorUrl: 'http://127.0.0.1:1',
        supervisorToken: '', codexBin: fakeCodex, webDir: workDir, agentDir: join(workDir, 'agent'),
        allowAnyOriginIp: true, addonVersion: '1.2.3',
    }
    await mkdir(env.haConfigDir, { recursive: true })
    await mkdir(env.agentDir, { recursive: true })
    await writeFile(join(env.agentDir, 'AGENTS.md'), '# agent rules\n')
    await writeFile(join(env.haConfigDir, 'automations.yaml'), '[]\n')
})

after(async () => {
    await rm(workDir, { recursive: true, force: true })
})

describe('JsonRpcProcess', () => {
    let rpc = null
    before(async () => {
        rpc = new JsonRpcProcess(fakeCodex, ['app-server'], { ...process.env, CODEX_HOME: workDir }, workDir)
        rpc.start()
        await rpc.request('initialize', { clientInfo: { name: 't', title: null, version: '1' }, capabilities: null })
    })
    after(async () => rpc.stop())

    it('skips invalid lines and joins partial lines', async () => {
        assert.deepEqual(await rpc.request('fake/garbage', {}), { garbage: true })
    })
    it('rejects JSON-RPC errors and timeouts', async () => {
        await assert.rejects(rpc.request('no/such', {}), (error) => error.code === -32601)
        await assert.rejects(rpc.request('fake/sleep', {}, 50), /timed out/)
    })
    it('answers server requests with -32601 without handler, else with the handler result', async () => {
        const missing = await rpc.request('fake/askClient', { method: 'x/y' })
        assert.equal(missing.error.code, -32601)
        rpc.setServerRequestHandler(async (method, params) => ({ method, echo: params }))
        const handled = await rpc.request('fake/askClient', { method: 'x/y', params: { a: 1 } })
        assert.deepEqual(handled.result, { method: 'x/y', echo: { a: 1 } })
    })
    it('rejects pending requests when the process exits', async () => {
        const pending = rpc.request('fake/sleep', {})
        const exited = waitFor(rpc, 'exit')
        await rpc.request('fake/exit', {})
        await assert.rejects(pending, /Codex process exited/)
        assert.deepEqual(await exited, [3])
        assert.equal(rpc.isRunning, false)
        await assert.rejects(rpc.request('initialize', {}), /not running/)
    })
})

describe('CodexSessionPool', () => {
    it('prepares CODEX_HOME once and keeps an existing config.toml', async () => {
        const home = join(workDir, 'prep', 'codex')
        await prepareCodexHome(home, env.agentDir)
        assert.equal((await stat(home)).mode & 0o777, 0o700)
        assert.equal(await readFile(join(home, 'config.toml'), 'utf8'), DEFAULT_CODEX_CONFIG)
        assert.equal(await readFile(join(home, 'AGENTS.md'), 'utf8'), '# agent rules\n')
        await writeFile(join(home, 'config.toml'), 'custom = true\n')
        await prepareCodexHome(home, env.agentDir)
        assert.equal(await readFile(join(home, 'config.toml'), 'utf8'), 'custom = true\n')
    })
    it('builds the spawn environment', () => {
        const built = buildCodexEnv({ PATH: '/usr/bin', KEEP: '1' }, '/u', '/u/codex', '/app')
        assert.deepEqual(built, { PATH: '/app/bin:/usr/bin', KEEP: '1', HOME: '/u', CODEX_HOME: '/u/codex' })
    })
    it('reuses the session, restarts it after a crash and stops idle sessions', async () => {
        const pool = new CodexSessionPool(env, { idleTimeoutMs: 150 })
        const first = await pool.get(USER)
        assert.equal(await pool.get(USER), first)
        await stat(join(userDataDir(env.dataDir, USER), 'codex', 'config.toml'))
        const exited = waitFor(first, 'exit')
        await first.request('fake/exit', {})
        await exited
        const second = await pool.get(USER)
        assert.notEqual(second, first)
        assert.equal(second.isRunning, true)
        pool.markBusy(USER, true)
        await new Promise((resolve) => setTimeout(resolve, 300))
        assert.equal(second.isRunning, true)
        pool.markBusy(USER, false)
        await waitFor(second, 'exit')
        await pool.stopAll()
    })
})

describe('AccountService and ModelService', () => {
    let pool = null
    const events = []
    const hub = { publish: (userId, event) => events.push({ userId, event }) }
    before(() => {
        pool = new CodexSessionPool(env)
    })
    after(async () => pool.stopAll())

    it('runs the device code login flow and logout', async () => {
        const accounts = new AccountService(pool, hub)
        assert.deepEqual(await accounts.getAccount(USER), { status: 'loggedOut' })
        const pending = await accounts.startLogin(USER)
        assert.equal(pending.status, 'pendingLogin')
        assert.equal(pending.userCode, 'ABCD-1234')
        assert.equal(pending.verificationUrl, 'https://auth.openai.com/codex/device')
        assert.deepEqual(await accounts.getAccount(USER), pending)
        const deadline = Date.now() + 5000
        while (!events.some((item) => item.event.account.status === 'loggedIn') && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 20))
        }
        const loggedIn = { status: 'loggedIn', email: 'fake.user@example.com', planType: 'plus' }
        assert.deepEqual(events.find((item) => item.event.account.status === 'loggedIn'), { userId: USER, event: { type: 'account.updated', account: loggedIn } })
        assert.deepEqual(await accounts.getAccount(USER), loggedIn)
        assert.deepEqual(await accounts.startLogin(USER), loggedIn)
        assert.deepEqual(await accounts.logout(USER), { status: 'loggedOut' })
    })
    it('cancels a pending login', async () => {
        const accounts = new AccountService(pool, hub)
        await accounts.startLogin('user-2')
        assert.deepEqual(await accounts.cancelLogin('user-2'), { status: 'loggedOut' })
        await new Promise((resolve) => setTimeout(resolve, 300))
        assert.deepEqual(await accounts.getAccount('user-2'), { status: 'loggedOut' })
    })
    it('lists visible models across pages and caches them', async () => {
        let calls = 0
        const countingPool = { get: async (userId) => {
            const session = await pool.get(userId)
            return { request: (method, params, timeout) => {
                calls++
                return session.request(method, params, timeout)
            } }
        } }
        const models = new ModelService(countingPool)
        const list = await models.listModels(USER)
        assert.deepEqual(list.map((model) => model.id), ['gpt-5.5-codex', 'gpt-5.4-mini'])
        assert.deepEqual(list[0].efforts.map((effort) => effort.id), ['low', 'medium', 'high', 'xhigh'])
        assert.equal(list[0].isDefault, true)
        assert.equal(list[0].defaultEffort, 'medium')
        assert.equal(list[1].isDefault, false)
        assert.equal(calls, 2)
        assert.equal(await models.listModels(USER), list)
        assert.equal(calls, 2)
    })
})

describe('fake app-server turns', () => {
    let pool = null
    let session = null
    before(async () => {
        pool = new CodexSessionPool(env)
        session = await pool.get('turn-user')
    })
    after(async () => pool.stopAll())

    it('creates an automation and reports friendly activities', async () => {
        const run = await runTurn(session, 'Vytvoř automatizace pro kotel')
        const entries = entriesOf(await run.notifications)
        const command = entries.find((entry) => entry.kind === 'activity' && entry.activity === 'command')
        assert.equal(command.title, 'Zjišťuji entity')
        assert.equal(command.status, 'done')
        const fileChange = entries.find((entry) => entry.kind === 'fileChange')
        assert.deepEqual(fileChange.files.map((file) => [file.path, file.changeKind]), [['automations.yaml', 'update']])
        assert.match(entries.at(-1).text, /Ranní zapnutí kotle/)
        const yaml = await readFile(join(env.haConfigDir, 'automations.yaml'), 'utf8')
        assert.match(yaml, /triggers:\n {4}- trigger: time/)
        assert.doesNotMatch(yaml, /^\[\]/)
    })
    it('asks the user through requestUserInput', async () => {
        session.setServerRequestHandler(async (method, params) => {
            assert.equal(method, 'item/tool/requestUserInput')
            assert.equal(mapRequestUserInput(params)[0].id, 'boiler')
            return buildUserInputResponse({ boiler: ['switch.kotel'] })
        })
        const run = await runTurn(session, 'otázka: zapni kotel')
        const entries = entriesOf(await run.notifications)
        assert.match(entries.at(-1).text, /Vybral jste switch.kotel/)
    })
    it('breaks YAML and repairs it unless asked to break it permanently', async () => {
        const path = join(env.haConfigDir, 'automations.yaml')
        const original = await readFile(path, 'utf8')
        for (const [prompt, expectFixed] of [['rozbij to', true], ['rozbij-trvale to', false]]) {
            const run = await runTurn(session, prompt)
            await run.notifications
            assert.match(await readFile(path, 'utf8'), /neuzavřeno/)
            const collected = collectTurn(session, run.thread.id)
            const repairText = 'Automatická kontrola konfigurace selhala: chyba. Oprav to.'
            await session.request('turn/start', { threadId: run.thread.id, input: [{ type: 'text', text: repairText, text_elements: [] }] })
            await collected
            const content = await readFile(path, 'utf8')
            assert.equal(content === original, expectFixed)
        }
        await writeFile(path, original)
    })
    it('interrupts a turn waiting for the user', async () => {
        session.setServerRequestHandler(() => new Promise(() => {}))
        const run = await runTurn(session, 'otázka bez odpovědi')
        await waitFor(session, 'notification', (method) => method === 'item/completed')
        await session.request('turn/interrupt', { threadId: run.thread.id, turnId: run.turn.id })
        const notifications = await run.notifications
        assert.equal(notifications.at(-1).params.turn.status, 'interrupted')
    })
})
