import {
    after,
    before,
    describe,
    it,
} from 'node:test'
import assert from 'node:assert/strict'
import {
    mkdir,
    rm,
    writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import {
    URL,
    fileURLToPath,
} from 'node:url'
import { ChatRunner } from '../dist/server/chats/chatRunner.js'
import { ChatStore } from '../dist/server/chats/chatStore.js'
import { userDirName } from '../dist/server/util/ids.js'
import {
    changedFile,
    createFakes,
    entriesOf,
    invalidCheck,
    replyTurn,
    user,
    validCheck,
    waitFor,
    waitForStatus,
} from './chatFakes.mjs'

const dataDir = join(fileURLToPath(new URL('.', import.meta.url)), '.tmp-chats-data')
describe('ChatStore', () => {
    before(async () => rm(dataDir, { recursive: true, force: true }))

    it('lists newest first and skips corrupted files', async () => {
        const store = new ChatStore(dataDir)
        const older = await store.create('store-user')
        const newer = await store.create('store-user', 'Světla')
        newer.updatedAt = new Date(Date.now() + 1000).toISOString()
        await store.save('store-user', newer)
        const chatsDir = join(dataDir, 'users', userDirName('store-user'), 'chats')
        await writeFile(join(chatsDir, 'broken.json'), '{not json')
        const list = await store.list('store-user')
        assert.deepEqual(list.map((chat) => chat.id), [newer.id, older.id])
        assert.equal(older.title, 'Nový chat')
        assert.equal(await store.get('store-user', '../etc'), null)
        assert.equal(await store.delete('store-user', older.id), true)
        assert.equal(await store.get('store-user', older.id), null)
    })
})

describe('ChatRunner', () => {
    before(async () => {
        await rm(dataDir, { recursive: true, force: true })
        await mkdir(dataDir, { recursive: true })
    })
    after(async () => rm(dataDir, { recursive: true, force: true }))

    it('happy path with a change records passed verification and ai-change snapshot', async () => {
        const fakes = createFakes(dataDir, { diffs: [[changedFile]], checks: [validCheck] })
        const chat = await fakes.store.create(user.id)
        await fakes.runner.sendMessage(user, chat.id, { text: 'Zapni světlo v 7:00', model: 'gpt-5', effort: null })
        const done = await waitForStatus(fakes, chat.id, ['idle'])
        assert.equal(done.title, 'Zapni světlo v 7:00')
        assert.equal(done.threadId, 'thread-1')
        assert.equal(done.model, 'gpt-5')
        const threadStart = fakes.session.requests.find((request) => request.method === 'thread/start')
        assert.match(threadStart.params.developerInstructions, /haos-tool snapshot/)
        assert.equal(threadStart.params.cwd, '/config')
        const turnStart = fakes.session.requests.find((request) => request.method === 'turn/start')
        assert.equal(turnStart.params.model, 'gpt-5')
        assert.equal('effort' in turnStart.params, false)
        const assistant = entriesOf(done, 'assistant')[0]
        assert.equal(assistant.text, 'Hotovo')
        assert.equal(assistant.streaming, false)
        assert.equal(entriesOf(done, 'verification')[0].result, 'passed')
        assert.equal(entriesOf(done, 'snapshot').length, 1)
        assert.deepEqual(fakes.history.snapshots.map((input) => input.kind), ['manual', 'ai-change'])
        assert.ok(fakes.events.some((event) => event.type === 'chat.delta' && event.delta === 'Hotovo'))
        assert.ok(fakes.events.some((event) => event.type === 'history.updated'))
        assert.deepEqual(fakes.pool.busy, [true, false])
    })

    it('invalid config triggers one repair turn and restores when still invalid', async () => {
        const fakes = createFakes(dataDir, { diffs: [[changedFile], [changedFile]], checks: [invalidCheck, invalidCheck] })
        const chat = await fakes.store.create(user.id)
        await fakes.runner.sendMessage(user, chat.id, { text: 'Přidej modbus', model: null, effort: 'high' })
        const done = await waitForStatus(fakes, chat.id, ['error'])
        const turnStarts = fakes.session.requests.filter((request) => request.method === 'turn/start')
        assert.equal(turnStarts.length, 2)
        assert.equal(turnStarts[0].params.effort, 'high')
        assert.match(turnStarts[1].params.input[0].text, /^Automatická kontrola konfigurace selhala/)
        assert.deepEqual(fakes.history.restores, [{ versionId: 'base', userName: 'Kuba' }])
        assert.equal(fakes.guard.reloads, 1)
        assert.equal(entriesOf(done, 'verification')[0].result, 'restored')
        assert.equal(done.effort, 'high')
    })

    it('no change produces no verification entry', async () => {
        const fakes = createFakes(dataDir)
        const chat = await fakes.store.create(user.id)
        await fakes.runner.sendMessage(user, chat.id, { text: 'Kolik mám světel?', model: null, effort: null })
        const done = await waitForStatus(fakes, chat.id, ['idle'])
        assert.equal(entriesOf(done, 'verification').length, 0)
        assert.equal(fakes.guard.checkCalls, 0)
    })

    it('second chat is queued while another turn runs', async () => {
        const releases = []
        const fakes = createFakes(dataDir, {
            turnScript: async (session, turnId) => {
                await new Promise((resolve) => releases.push(resolve))
                await replyTurn(session, turnId)
            },
        })
        const first = await fakes.store.create(user.id)
        const second = await fakes.store.create(user.id)
        await fakes.runner.sendMessage(user, first.id, { text: 'První', model: null, effort: null })
        await waitFor(() => releases.length === 1)
        await fakes.runner.sendMessage(user, second.id, { text: 'Druhý', model: null, effort: null })
        assert.equal((await fakes.store.get(user.id, second.id)).status, 'queued')
        await assert.rejects(
            fakes.runner.sendMessage(user, second.id, { text: 'Znovu', model: null, effort: null }),
            { statusCode: 409 },
        )
        releases[0]()
        await waitFor(() => releases.length === 2)
        releases[1]()
        await waitForStatus(fakes, second.id, ['idle'])
        assert.equal((await fakes.store.get(user.id, first.id)).status, 'idle')
    })

    it('question flow resolves the server request with the answers', async () => {
        let serverReply = null
        const fakes = createFakes(dataDir, {
            turnScript: async (session, turnId) => {
                serverReply = await session.handler('item/tool/requestUserInput', {
                    threadId: 'thread-1',
                    turnId,
                    itemId: 'ask-1',
                    questions: [{
                        id: 'q1',
                        header: 'Světlo',
                        question: 'Které světlo?',
                        isOther: false,
                        isSecret: false,
                        options: [{ label: 'Kuchyň', description: 'light.kitchen' }],
                    }],
                })
                await replyTurn(session, turnId)
            },
        })
        const chat = await fakes.store.create(user.id)
        await fakes.runner.sendMessage(user, chat.id, { text: 'Zapni světlo', model: null, effort: null })
        const waiting = await waitForStatus({ ...fakes, runner: { isBusy: () => false } }, chat.id, ['waitingForUser'])
        const question = entriesOf(waiting, 'question')[0]
        assert.equal(question.questions[0].question, 'Které světlo?')
        await fakes.runner.answer(user, chat.id, { requestId: question.requestId, answers: { q1: ['Kuchyň'] } })
        const done = await waitForStatus(fakes, chat.id, ['idle'])
        assert.deepEqual(serverReply, { answers: { q1: { answers: ['Kuchyň'] } } })
        assert.equal(entriesOf(done, 'question')[0].answered, true)
        const approval = await fakes.session.handler('item/fileChange/requestApproval', {})
        assert.deepEqual(approval, { decision: 'accept' })
        await assert.rejects(fakes.session.handler('unknown/method', {}))
    })

    it('stale question after restart is closed and answers are sent as a new message', async () => {
        const fakes = createFakes(dataDir)
        const chat = await fakes.store.create(user.id, 'Starý')
        chat.status = 'waitingForUser'
        chat.entries.push({
            id: 'e1',
            at: new Date().toISOString(),
            kind: 'question',
            requestId: 'req-old',
            questions: [{ id: 'q1', header: 'H', question: 'Která místnost?', allowOther: true, options: [] }],
            answered: false,
            answers: null,
        })
        await fakes.store.save(user.id, chat)
        await fakes.runner.answer(user, chat.id, { requestId: 'req-old', answers: { q1: ['Obývák'] } })
        const done = await waitForStatus(fakes, chat.id, ['idle'])
        assert.equal(entriesOf(done, 'question')[0].answered, true)
        const turnStart = fakes.session.requests.find((request) => request.method === 'turn/start')
        assert.match(turnStart.params.input[0].text, /Která místnost\?: Obývák/)
        await assert.rejects(
            fakes.runner.answer(user, chat.id, { requestId: 'req-old', answers: {} }),
            { statusCode: 409 },
        )
    })

    it('rename during a turn is kept', async () => {
        const releases = []
        const fakes = createFakes(dataDir, {
            turnScript: async (session, turnId) => {
                await new Promise((resolve) => releases.push(resolve))
                await replyTurn(session, turnId)
            },
        })
        const chat = await fakes.store.create(user.id)
        await fakes.runner.sendMessage(user, chat.id, { text: 'Úloha', model: null, effort: null })
        await waitFor(() => releases.length === 1)
        const summary = await fakes.runner.rename(user, chat.id, '  Přejmenováno ')
        assert.equal(summary.title, 'Přejmenováno')
        releases[0]()
        const done = await waitForStatus(fakes, chat.id, ['idle'])
        assert.equal(done.title, 'Přejmenováno')
        assert.equal(entriesOf(done, 'assistant').length, 1)
    })

    it('interrupt sends turn/interrupt and ends idle', async () => {
        const fakes = createFakes(dataDir, { turnScript: async () => undefined })
        const chat = await fakes.store.create(user.id)
        await fakes.runner.sendMessage(user, chat.id, { text: 'Dlouhá úloha', model: null, effort: null })
        await waitFor(() => fakes.session.turnCount === 1)
        await fakes.runner.interrupt(user, chat.id)
        const done = await waitForStatus(fakes, chat.id, ['idle'])
        const interrupt = fakes.session.requests.find((request) => request.method === 'turn/interrupt')
        assert.deepEqual(interrupt.params, { threadId: 'thread-1', turnId: 'turn-1' })
        assert.equal(entriesOf(done, 'error').length, 0)
    })

    it('turn timeout interrupts the turn and records an error', async () => {
        const fakes = createFakes(dataDir, { turnScript: async () => undefined })
        const runner = new ChatRunner({
            store: fakes.store,
            pool: fakes.pool,
            hub: { publish() {}, broadcast() {} },
            history: fakes.history,
            guard: fakes.guard,
            env: { haConfigDir: '/config' },
            turnTimeoutMs: 30,
        })
        const chat = await fakes.store.create(user.id)
        await runner.sendMessage(user, chat.id, { text: 'Timeout', model: null, effort: null })
        const done = await waitForStatus({ ...fakes, runner }, chat.id, ['idle'])
        assert.ok(fakes.session.methods().includes('turn/interrupt'))
        assert.equal(entriesOf(done, 'error').length, 1)
    })
})
