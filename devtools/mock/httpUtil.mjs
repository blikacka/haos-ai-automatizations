/**
 * Small HTTP helpers for the mock servers.
 */

export const MAX_BODY_BYTES = 1024 * 1024

/**
 * @param {import('node:http').ServerResponse} res response
 * @param {number} status HTTP status
 * @param {unknown} body JSON serialisable body
 */
export function sendJson(res, status, body) {
    const payload = JSON.stringify(body)
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) })
    res.end(payload)
}

/**
 * @param {import('node:http').ServerResponse} res response
 * @param {number} status HTTP status
 * @param {string} text plain text body
 */
export function sendText(res, status, text) {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text) })
    res.end(text)
}

/**
 * Supervisor style success envelope.
 *
 * @param {import('node:http').ServerResponse} res response
 * @param {unknown} data payload
 */
export function sendOk(res, data = {}) {
    sendJson(res, 200, { result: 'ok', data })
}

/**
 * Supervisor style error envelope.
 *
 * @param {import('node:http').ServerResponse} res response
 * @param {number} status HTTP status
 * @param {string} message error message
 */
export function sendSupervisorError(res, status, message) {
    sendJson(res, status, { result: 'error', message, data: {} })
}

/**
 * Reads and parses a JSON body (empty body -> {}), limited to 1 MB.
 *
 * @param {import('node:http').IncomingMessage} req request
 * @returns {Promise<Record<string, unknown>>} parsed body
 * @throws {Error} on invalid JSON or oversize body
 */
export async function readJsonBody(req) {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
            throw new Error('Request body too large')
        }
        chunks.push(chunk)
    }
    const text = Buffer.concat(chunks).toString('utf8').trim()
    if (text === '') {
        return {}
    }
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
}

/**
 * Accepts `Authorization: Bearer <token>` or `X-Supervisor-Token: <token>`.
 *
 * @param {import('node:http').IncomingMessage} req request
 * @param {string} token expected token
 * @returns {boolean} true when authorised
 */
export function isAuthorized(req, token) {
    const header = req.headers.authorization ?? ''
    const bearer = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null
    return bearer === token || req.headers['x-supervisor-token'] === token
}
