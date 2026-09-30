import assert from 'node:assert/strict'
import {
    createServer,
    type IncomingMessage,
    type Server,
    type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import {
    after,
    before,
    describe,
    it,
} from 'node:test'
import { WebSocketServer } from 'ws'
import {
    SupervisorClient,
    SupervisorError,
} from '../dist/server/ha/supervisorClient.js'
import { ConfigGuard } from '../dist/server/ha/configGuard.js'

const TOKEN = 'test-secret-token'

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(payload))
}

function handleRequest(request: IncomingMessage, response: ServerResponse): void {
    if (request.headers.authorization !== `Bearer ${TOKEN}`) {
        sendJson(response, 401, { message: 'unauthorized' })
        return
    }
    switch (`${request.method} ${request.url}`) {
        case 'GET /info':
            sendJson(response, 200, { result: 'ok', data: { hostname: 'ha' } })
            return
        case 'GET /broken':
            sendJson(response, 400, { result: 'error', message: 'bad thing' })
            return
        case 'POST /core/api/config/core/check_config':
            sendJson(response, 200, { result: 'invalid', errors: 'Integration error: foo' })
            return
        case 'GET /core/api/error_log':
            response.writeHead(200, { 'Content-Type': 'text/plain' })
            response.end('log line')
            return
        default:
            sendJson(response, 404, { message: 'not found' })
    }
}

describe('SupervisorClient', () => {
    let server: Server
    let baseUrl = ''

    before(async () => {
        server = createServer(handleRequest)
        const wss = new WebSocketServer({ server, path: '/core/websocket' })
        wss.on('connection', (socket) => {
            socket.send(JSON.stringify({ type: 'auth_required' }))
            socket.on('message', (raw) => {
                const message = JSON.parse(raw.toString()) as Record<string, unknown>
                if (message.type === 'auth') {
                    socket.send(JSON.stringify({ type: message.access_token === TOKEN ? 'auth_ok' : 'auth_invalid', message: 'Invalid access' }))
                } else if (message.type === 'config/area_registry/list') {
                    socket.send(JSON.stringify({ id: message.id, type: 'result', success: true, result: [{ area_id: 'kitchen' }] }))
                } else {
                    socket.send(JSON.stringify({ id: message.id, type: 'result', success: false, error: { code: 'unknown_command', message: 'Unknown command.' } }))
                }
            })
        })
        await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    })

    after(async () => {
        server.closeAllConnections()
        await new Promise((done) => server.close(done))
    })

    it('unwraps supervisor responses', async () => {
        const client = new SupervisorClient(baseUrl, TOKEN)
        assert.deepEqual(await client.supervisor('GET', '/info'), { hostname: 'ha' })
        assert.equal(await client.core('GET', '/api/error_log'), 'log line')
    })

    it('reports status and message without leaking the token', async () => {
        const client = new SupervisorClient(baseUrl, TOKEN)
        await assert.rejects(client.supervisor('GET', '/broken'), (error: unknown) => {
            assert.ok(error instanceof SupervisorError)
            assert.equal(error.status, 400)
            assert.match(error.message, /bad thing/)
            assert.doesNotMatch(error.message, new RegExp(TOKEN))
            return true
        })
    })

    it('runs one-shot websocket commands', async () => {
        const client = new SupervisorClient(baseUrl, TOKEN)
        assert.deepEqual(await client.coreWs({ type: 'config/area_registry/list' }), [{ area_id: 'kitchen' }])
        await assert.rejects(client.coreWs({ type: 'nope' }), /unknown_command/)
    })

    it('rejects invalid websocket auth', async () => {
        const client = new SupervisorClient(baseUrl, 'wrong-token')
        await assert.rejects(client.coreWs({ type: 'config/area_registry/list' }), (error: unknown) => {
            assert.ok(error instanceof SupervisorError)
            assert.equal(error.status, 401)
            assert.doesNotMatch(error.message, /wrong-token/)
            return true
        })
    })

    it('ConfigGuard maps check results and refuses restart when invalid', async () => {
        const guard = new ConfigGuard(new SupervisorClient(baseUrl, TOKEN))
        assert.deepEqual(await guard.checkConfig(), { valid: false, errors: 'Integration error: foo' })
        await assert.rejects(guard.restartCore(), /není platná/)
    })
})
