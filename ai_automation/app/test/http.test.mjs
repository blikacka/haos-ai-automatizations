/* global fetch, URL */
import assert from 'node:assert/strict'
import {
    mkdir,
    mkdtemp,
    rm,
    writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { Router, sendJson, HttpError, MAX_BODY_BYTES } from '../dist/server/http/router.js'
import { resolveUser, normalizeIp, INGRESS_PROXY_IP } from '../dist/server/http/identity.js'
import { StaticFiles } from '../dist/server/http/staticFiles.js'
import { EventHub } from '../dist/server/http/eventHub.js'
import { createAppServer } from '../dist/server/http/server.js'
import { ChatStore } from '../dist/server/chats/chatStore.js'

const USER = { id: 'user1', name: 'kuba', displayName: 'Kuba' }
const scratchRoot = join(fileURLToPath(new URL('..', import.meta.url)), 'test-scratch')

function listenOn(server) {
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))
    })
}

function closeServer(server) {
    return new Promise((resolve) => server.close(() => resolve()))
}

function fakeRequest(remoteAddress, headers = {}) {
    return { socket: { remoteAddress }, headers }
}

describe('router', () => {
    let server
    let baseUrl
    before(async () => {
        const router = new Router()
        router.add('GET', '/api/chats/:id', async ({ params }) => ({ id: params.id }))
        router.add('GET', '/api/history/:sha', async ({ params }) => ({ sha: params.sha }))
        router.add('POST', '/api/echo', async ({ body }) => ({ body }))
        router.add('POST', '/api/accepted', async ({ res }) => sendJson(res, 202, { ok: true }))
        router.add('GET', '/api/fail', async () => { throw new Error('secret detail') })
        router.add('GET', '/api/conflict', async () => { throw new HttpError(409, 'busy') })
        server = createServer((req, res) => {
            router.handle(req, res, USER).then((handled) => {
                if (!handled) {
                    sendJson(res, 404, { error: 'not found' })
                }
            })
        })
        baseUrl = await listenOn(server)
    })
    after(() => closeServer(server))

    it('matches params', async () => {
        const response = await fetch(`${baseUrl}/api/chats/abc_DEF-1`)
        assert.equal(response.status, 200)
        assert.deepEqual(await response.json(), { id: 'abc_DEF-1' })
    })

    it('rejects unsafe ids and invalid shas', async () => {
        assert.equal((await fetch(`${baseUrl}/api/chats/a%2F..%2Fb`)).status, 400)
        assert.equal((await fetch(`${baseUrl}/api/chats/${'x'.repeat(65)}`)).status, 400)
        assert.equal((await fetch(`${baseUrl}/api/history/XYZ1234`)).status, 400)
        assert.equal((await fetch(`${baseUrl}/api/history/abcdef1`)).status, 200)
    })

    it('returns 404 for unknown path and 405 for wrong method', async () => {
        assert.equal((await fetch(`${baseUrl}/api/nope`)).status, 404)
        assert.equal((await fetch(`${baseUrl}/api/echo`)).status, 405)
    })

    it('parses JSON bodies', async () => {
        const response = await fetch(`${baseUrl}/api/echo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ text: 'ahoj' }),
        })
        assert.equal(response.status, 200)
        assert.deepEqual(await response.json(), { body: { text: 'ahoj' } })
    })

    it('rejects non JSON content types with 415', async () => {
        const response = await fetch(`${baseUrl}/api/echo`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: '{"text":"x"}',
        })
        assert.equal(response.status, 415)
    })

    it('rejects malformed JSON with 400', async () => {
        const response = await fetch(`${baseUrl}/api/echo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{broken',
        })
        assert.equal(response.status, 400)
    })

    it('rejects bodies over the limit with 413', async () => {
        const response = await fetch(`${baseUrl}/api/echo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'x'.repeat(MAX_BODY_BYTES) }),
        })
        assert.equal(response.status, 413)
    })

    it('supports custom status and hides internal errors', async () => {
        const accepted = await fetch(`${baseUrl}/api/accepted`, { method: 'POST' })
        assert.equal(accepted.status, 202)
        const failed = await fetch(`${baseUrl}/api/fail`)
        assert.equal(failed.status, 500)
        assert.ok(!(await failed.text()).includes('secret detail'))
        const conflict = await fetch(`${baseUrl}/api/conflict`)
        assert.equal(conflict.status, 409)
        assert.deepEqual(await conflict.json(), { error: 'busy' })
    })
})

describe('identity', () => {
    const strictEnv = { allowAnyOriginIp: false }
    const headers = { 'x-remote-user-id': 'abc', 'x-remote-user-name': 'kuba', 'x-remote-user-display-name': 'Kuba' }

    it('normalizes IPv4-mapped addresses', () => {
        assert.equal(normalizeIp('::ffff:172.30.32.2'), INGRESS_PROXY_IP)
    })

    it('accepts only the ingress proxy', () => {
        assert.deepEqual(resolveUser(fakeRequest('172.30.32.2', headers), strictEnv),
            { id: 'abc', name: 'kuba', displayName: 'Kuba' })
        assert.ok(resolveUser(fakeRequest('::ffff:172.30.32.2', headers), strictEnv))
        assert.equal(resolveUser(fakeRequest('172.30.32.3', headers), strictEnv), null)
        assert.equal(resolveUser(fakeRequest('127.0.0.1', headers), strictEnv), null)
    })

    it('bypasses the IP check when allowed', () => {
        assert.ok(resolveUser(fakeRequest('10.0.0.5', headers), { allowAnyOriginIp: true }))
    })

    it('requires the user id and sanitizes names', () => {
        assert.equal(resolveUser(fakeRequest(INGRESS_PROXY_IP, {}), strictEnv), null)
        assert.equal(resolveUser(fakeRequest(INGRESS_PROXY_IP, { 'x-remote-user-id': 'a'.repeat(129) }), strictEnv), null)
        const user = resolveUser(fakeRequest(INGRESS_PROXY_IP, {
            'x-remote-user-id': 'abc',
            'x-remote-user-name': `ev\u0007il${'n'.repeat(300)}`,
        }), strictEnv)
        assert.equal(user.name.length, 128)
        assert.ok(user.name.startsWith('evil'))
        assert.equal(user.displayName, user.name)
    })
})

describe('staticFiles', () => {
    let webDir
    let files
    before(async () => {
        await mkdir(scratchRoot, { recursive: true })
        webDir = await mkdtemp(join(scratchRoot, 'web-'))
        await writeFile(join(webDir, 'index.html'), '<!doctype html>')
        await writeFile(join(webDir, 'app.js'), 'console.log(1)')
        await writeFile(join(scratchRoot, 'secret.txt'), 'secret')
        files = new StaticFiles(webDir)
    })
    after(() => rm(scratchRoot, { recursive: true, force: true }))

    it('serves existing files and falls back to index.html', async () => {
        assert.equal(await files.resolveFile('/app.js'), join(webDir, 'app.js'))
        assert.equal(await files.resolveFile('/some/route'), join(webDir, 'index.html'))
        assert.equal(await files.resolveFile('/'), join(webDir, 'index.html'))
    })

    it('never resolves outside the web dir', async () => {
        const attempts = [
            '/../../etc/passwd',
            '/%2e%2e/%2e%2e/etc/passwd',
            '/..%2f..%2fsecret.txt',
            '/%2e%2e%2fsecret.txt',
            '/..%5csecret.txt',
        ]
        for (const attempt of attempts) {
            let resolved = null
            try {
                resolved = await files.resolveFile(attempt)
            } catch (error) {
                assert.ok([400, 403].includes(error.status), `${attempt} -> ${error.status}`)
                continue
            }
            assert.ok(resolved.startsWith(webDir), `${attempt} resolved to ${resolved}`)
        }
    })
})

describe('eventHub', () => {
    let server
    let baseUrl
    let hub
    before(async () => {
        hub = new EventHub()
        server = createServer((req, res) => res.end())
        hub.attach(server, (req) => (req.headers['x-remote-user-id'] === 'user1' ? USER : null))
        baseUrl = (await listenOn(server)).replace('http', 'ws')
    })
    after(() => {
        server.closeAllConnections()
        return closeServer(server)
    })

    it('publishes events to the connected user', async () => {
        const socket = new WebSocket(`${baseUrl}/api/hassio_ingress/token/api/events`, {
            headers: { 'x-remote-user-id': 'user1' },
        })
        await new Promise((resolve, reject) => {
            socket.once('open', resolve)
            socket.once('error', reject)
        })
        const received = new Promise((resolve) => socket.once('message', (data) => resolve(JSON.parse(String(data)))))
        hub.publish('other', { type: 'history.updated' })
        hub.publish('user1', { type: 'chat.deleted', chatId: 'abc' })
        assert.deepEqual(await received, { type: 'chat.deleted', chatId: 'abc' })
        socket.close()
    })

    it('rejects unauthenticated upgrades with 401', async () => {
        const socket = new WebSocket(`${baseUrl}/api/events`)
        const status = await new Promise((resolve) => {
            socket.once('unexpected-response', (req, res) => resolve(res.statusCode))
            socket.once('error', () => resolve('error'))
        })
        assert.equal(status, 401)
    })
})

describe('app server', () => {
    const calls = []
    let server
    let baseUrl
    let dataDir
    let env
    before(async () => {
        await mkdir(scratchRoot, { recursive: true })
        dataDir = await mkdtemp(join(scratchRoot, 'data-'))
        env = { allowAnyOriginIp: false, webDir: dataDir, dataDir, addonVersion: '1.0.0' }
        const runner = {
            sendMessage: async (user, chatId, request) => { calls.push({ chatId, request }) },
            interrupt: async () => { throw new Error('Chat neběží') },
            answer: async () => undefined,
            isBusy: () => false,
        }
        const hub = new EventHub()
        server = createAppServer({ env, hub, store: new ChatStore(dataDir), runner, accounts: {}, models: {}, history: {}, restore: {}, guard: {} })
        baseUrl = await listenOn(server)
    })
    after(async () => {
        server.closeAllConnections()
        await closeServer(server)
        await rm(scratchRoot, { recursive: true, force: true })
    })

    it('serves health without identity and sets security headers', async () => {
        const response = await fetch(`${baseUrl}/api/health`)
        assert.equal(response.status, 200)
        assert.deepEqual(await response.json(), { ok: true })
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
        assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'self'/)
        assert.equal(response.headers.get('x-frame-options'), null)
    })

    it('rejects requests not coming from ingress', async () => {
        assert.equal((await fetch(`${baseUrl}/api/chats`, { headers: { 'x-remote-user-id': 'u1' } })).status, 403)
    })

    it('validates and queues chat messages', async () => {
        env.allowAnyOriginIp = true
        const headers = { 'x-remote-user-id': 'u1', 'content-type': 'application/json' }
        const created = await (await fetch(`${baseUrl}/api/chats`, { method: 'POST', headers, body: '{}' })).json()
        const url = `${baseUrl}/api/chats/${created.id}/messages`
        const send = (body) => fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
        assert.equal((await send({ text: '  ', model: null, effort: null })).status, 400)
        assert.equal((await send({ text: 'x'.repeat(20001), model: null, effort: null })).status, 400)
        assert.equal((await send({ text: 'ahoj', model: 'm'.repeat(65), effort: null })).status, 400)
        assert.equal((await send({ text: 'ahoj', model: 'gpt-5', effort: 'high' })).status, 202)
        assert.deepEqual(calls.at(-1), { chatId: created.id, request: { text: 'ahoj', model: 'gpt-5', effort: 'high' } })
        const interrupt = await fetch(`${baseUrl}/api/chats/${created.id}/interrupt`, { method: 'POST', headers })
        assert.equal(interrupt.status, 409)
        assert.equal((await fetch(`${baseUrl}/api/chats/missing1/messages`, {
            method: 'POST', headers, body: JSON.stringify({ text: 'x' }),
        })).status, 404)
        const crossSite = await fetch(`${baseUrl}/api/chats`, {
            method: 'POST', headers: { ...headers, 'sec-fetch-site': 'cross-site' }, body: '{}',
        })
        assert.equal(crossSite.status, 403)
    })
})
