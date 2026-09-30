import { EventEmitter } from 'node:events'
import {
    setImmediate,
    setTimeout,
} from 'node:timers'
import { ChatRunner } from '../dist/server/chats/chatRunner.js'
import { ChatStore } from '../dist/server/chats/chatStore.js'

/** Shared fakes for chat tests (FakeSession, fake history / guard / pool / hub). */

export const user = { id: 'user-1', name: 'kuba', displayName: 'Kuba' }
export const validCheck = { valid: true, errors: null }
export const invalidCheck = { valid: false, errors: 'Invalid config for automation' }
export const changedFile = { path: 'automations.yaml', changeKind: 'update', diff: '+x' }

/** Fake CodexSession: records requests and plays a scripted turn for every turn/start. */
class FakeSession extends EventEmitter {
    constructor(turnScript) {
        super()
        this.requests = []
        this.turnCount = 0
        this.handler = null
        this.turnScript = turnScript
    }

    setServerRequestHandler(handler) {
        this.handler = handler
    }

    async request(method, params) {
        this.requests.push({ method, params })
        if (method === 'thread/start') {
            return { thread: { id: 'thread-1' } }
        }
        if (method === 'turn/start') {
            this.turnCount += 1
            const turnId = `turn-${this.turnCount}`
            setImmediate(() => {
                void this.turnScript(this, turnId, params)
            })
            return { turn: { id: turnId, status: 'inProgress' } }
        }
        if (method === 'turn/interrupt') {
            setImmediate(() => this.complete(params.turnId, 'interrupted'))
        }
        return {}
    }

    notify(method, params) {
        this.emit('notification', method, { threadId: 'thread-1', ...params })
    }

    complete(turnId, status = 'completed') {
        this.notify('turn/completed', { turn: { id: turnId, status, error: null } })
    }

    methods() {
        return this.requests.map((request) => request.method)
    }
}

export async function replyTurn(session, turnId) {
    const item = { type: 'agentMessage', id: `msg-${turnId}`, text: '' }
    session.notify('item/started', { turnId, item })
    session.notify('item/agentMessage/delta', { turnId, itemId: item.id, delta: 'Hotovo' })
    session.notify('item/completed', { turnId, item: { ...item, text: 'Hotovo' } })
    session.complete(turnId)
}

export function createFakes(dataDir, { diffs = [], checks = [], turnScript = replyTurn } = {}) {
    const session = new FakeSession(turnScript)
    const events = []
    const history = {
        snapshots: [],
        restores: [],
        async snapshot(input) {
            this.snapshots.push(input)
            return input.kind === 'manual' ? null : { id: `v${this.snapshots.length}`, title: input.title }
        },
        async currentVersionId() {
            return 'base'
        },
        async restore(versionId, userName) {
            this.restores.push({ versionId, userName })
            return { version: { id: 'restored-1', title: 'Obnoveno' }, changedPaths: ['automations.yaml'] }
        },
        async diffWorkTree() {
            return diffs.shift() ?? []
        },
    }
    const guard = {
        checkCalls: 0,
        reloads: 0,
        async checkConfig() {
            this.checkCalls += 1
            return checks.shift() ?? validCheck
        },
        async reloadAll() {
            this.reloads += 1
        },
    }
    const pool = {
        busy: [],
        async get() {
            return session
        },
        markBusy(userId, busy) {
            this.busy.push(busy)
        },
    }
    const hub = {
        publish(userId, event) {
            events.push(event)
        },
        broadcast(event) {
            events.push(event)
        },
    }
    const store = new ChatStore(dataDir)
    const runner = new ChatRunner({ store, pool, hub, history, guard, env: { haConfigDir: '/config' } })
    return { session, events, history, guard, pool, store, runner }
}

export async function waitFor(predicate, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs
    while (!(await predicate())) {
        if (Date.now() > deadline) {
            throw new Error('waitFor timed out')
        }
        await new Promise((resolve) => setTimeout(resolve, 5))
    }
}

export async function waitForStatus(fakes, chatId, statuses) {
    await waitFor(async () => {
        const chat = await fakes.store.get(user.id, chatId)
        return chat !== null && statuses.includes(chat.status) && !fakes.runner.isBusy()
    })
    return fakes.store.get(user.id, chatId)
}

export function entriesOf(chat, kind) {
    return chat.entries.filter((entry) => entry.kind === kind)
}
