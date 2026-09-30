#!/usr/bin/env node
/**
 * Emulates the HA ingress proxy: serves the add-on under /api/hassio_ingress/<token>/, strips the prefix,
 * forwards HTTP + WebSocket to the add-on and injects X-Remote-User-* identity headers.
 *
 * Switch user with ?user=<id> (remembered in the "devuser" cookie). Known ids: dev-user-1 (Jakub), dev-user-2 (Petra).
 * Env: INGRESS_PORT (8098), ADDON_HOST (127.0.0.1), ADDON_PORT (8099), INGRESS_TOKEN (devtoken).
 */
import {
    createServer,
    request as httpRequest,
} from 'node:http'

const LISTEN_PORT = Number(process.env.INGRESS_PORT ?? 8098)
const ADDON_HOST = process.env.ADDON_HOST ?? '127.0.0.1'
const ADDON_PORT = Number(process.env.ADDON_PORT ?? 8099)
const INGRESS_PREFIX = `/api/hassio_ingress/${process.env.INGRESS_TOKEN ?? 'devtoken'}`
const DEFAULT_USER_ID = 'dev-user-1'
const USER_COOKIE = 'devuser'
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const IDENTITY_HEADERS = ['x-remote-user-id', 'x-remote-user-name', 'x-remote-user-display-name', 'x-ingress-path']

const KNOWN_USERS = {
    'dev-user-1': { name: 'jakub', displayName: 'Jakub' },
    'dev-user-2': { name: 'petra', displayName: 'Petra Řeháková' },
}

/**
 * @param {string | undefined} cookieHeader raw Cookie header
 * @returns {string | null} devuser cookie value when valid
 */
function userFromCookie(cookieHeader) {
    for (const part of (cookieHeader ?? '').split(';')) {
        const [key, ...valueParts] = part.trim().split('=')
        const value = decodeURIComponent(valueParts.join('='))
        if (key === USER_COOKIE && USER_ID_PATTERN.test(value)) {
            return value
        }
    }
    return null
}

/**
 * Resolves the emulated HA user and the upstream path.
 *
 * @param {import('node:http').IncomingMessage} req request
 * @returns {{ upstreamPath: string, userId: string, setCookie: string | null } | null} null when outside the prefix
 */
function resolveRequest(req) {
    const url = new URL(req.url ?? '/', 'http://ingress')
    if (!url.pathname.startsWith(`${INGRESS_PREFIX}/`)) {
        return null
    }
    const queryUser = url.searchParams.get('user')
    const hasValidQueryUser = queryUser !== null && USER_ID_PATTERN.test(queryUser)
    url.searchParams.delete('user')
    const userId = hasValidQueryUser ? queryUser : userFromCookie(req.headers.cookie) ?? DEFAULT_USER_ID
    const setCookie = hasValidQueryUser
        ? `${USER_COOKIE}=${encodeURIComponent(queryUser)}; Path=${INGRESS_PREFIX}/; HttpOnly; SameSite=Strict`
        : null
    return { upstreamPath: `${url.pathname.slice(INGRESS_PREFIX.length)}${url.search}`, userId, setCookie }
}

/**
 * Real HA ingress (aiohttp) writes header values as UTF-8 bytes; Node reads them back as latin1.
 * Emitting the same bytes here keeps the add-on's header decoding honest.
 *
 * @param {string} value header value
 * @returns {string} latin1 string carrying the UTF-8 bytes
 */
function asRawUtf8(value) {
    return Buffer.from(value, 'utf8').toString('latin1')
}

/**
 * @param {import('node:http').IncomingMessage} req client request
 * @param {string} userId emulated user id
 * @returns {import('node:http').OutgoingHttpHeaders} upstream headers
 */
function upstreamHeaders(req, userId) {
    const headers = { ...req.headers }
    for (const name of IDENTITY_HEADERS) {
        delete headers[name]
    }
    const user = KNOWN_USERS[userId] ?? { name: userId, displayName: userId }
    return {
        ...headers,
        host: `${ADDON_HOST}:${ADDON_PORT}`,
        'x-remote-user-id': userId,
        'x-remote-user-name': user.name,
        'x-remote-user-display-name': asRawUtf8(user.displayName),
        'x-ingress-path': INGRESS_PREFIX,
        'x-forwarded-for': req.socket.remoteAddress ?? '127.0.0.1',
    }
}

/**
 * @param {import('node:http').ServerResponse} res response
 */
function redirectToPrefix(res) {
    res.writeHead(302, { Location: `${INGRESS_PREFIX}/` })
    res.end()
}

const server = createServer((req, res) => {
    const resolved = resolveRequest(req)
    if (!resolved) {
        const path = new URL(req.url ?? '/', 'http://ingress').pathname
        if (path === '/' || path === INGRESS_PREFIX) {
            redirectToPrefix(res)
            return
        }
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(`Not found. Open ${INGRESS_PREFIX}/\n`)
        return
    }
    const upstream = httpRequest({
        host: ADDON_HOST,
        port: ADDON_PORT,
        method: req.method,
        path: resolved.upstreamPath,
        headers: upstreamHeaders(req, resolved.userId),
    }, (upstreamRes) => {
        const headers = { ...upstreamRes.headers }
        if (resolved.setCookie) {
            headers['set-cookie'] = [...[headers['set-cookie'] ?? []].flat(), resolved.setCookie]
        }
        res.writeHead(upstreamRes.statusCode ?? 502, headers)
        upstreamRes.pipe(res)
    })
    upstream.on('error', (error) => {
        if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
        }
        res.end(`502 Bad Gateway: add-on not reachable (${error.message})\n`)
    })
    req.pipe(upstream)
})

server.on('upgrade', (req, socket, head) => {
    const resolved = resolveRequest(req)
    if (!resolved) {
        socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
        return
    }
    const upstream = httpRequest({
        host: ADDON_HOST,
        port: ADDON_PORT,
        method: req.method,
        path: resolved.upstreamPath,
        headers: upstreamHeaders(req, resolved.userId),
    })
    upstream.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
        const headerLines = Object.entries(upstreamRes.headers)
            .flatMap(([name, value]) => [value].flat().map((item) => `${name}: ${item}`))
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headerLines.join('\r\n')}\r\n\r\n`)
        if (upstreamHead.length > 0) {
            socket.write(upstreamHead)
        }
        if (head.length > 0) {
            upstreamSocket.write(head)
        }
        upstreamSocket.pipe(socket).pipe(upstreamSocket)
        upstreamSocket.on('error', () => socket.destroy())
        socket.on('error', () => upstreamSocket.destroy())
    })
    upstream.on('response', (upstreamRes) => {
        socket.end(`HTTP/1.1 ${upstreamRes.statusCode ?? 502} Upgrade Refused\r\nConnection: close\r\n\r\n`)
    })
    upstream.on('error', () => socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'))
    upstream.end()
})

server.listen(LISTEN_PORT, '127.0.0.1', () => {
    console.log(`[ingress-proxy] http://127.0.0.1:${LISTEN_PORT}${INGRESS_PREFIX}/ -> http://${ADDON_HOST}:${ADDON_PORT}`)
})

const shutdown = () => server.close(() => process.exit(0))
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
