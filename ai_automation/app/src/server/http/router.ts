import type {
    IncomingMessage,
    ServerResponse,
} from 'node:http'
import type { CurrentUser } from '../../shared/api.js'
import { isSafeId } from '../util/ids.js'
import { logger } from '../util/logger.js'

/** Maximum accepted request body size in bytes (1 MB). */
export const MAX_BODY_BYTES = 1024 * 1024

const COMMIT_ID_PATTERN = /^[0-9a-f]{7,40}$/
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const GENERIC_ERROR = 'Interní chyba serveru'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** Error carrying an HTTP status; its message is safe to show to the client. */
export class HttpError extends Error {
    /**
     * @param status HTTP status code (4xx/5xx)
     * @param message client-facing message
     */
    constructor(public readonly status: number, message: string) {
        super(message)
        this.name = 'HttpError'
    }
}

/** Context passed to every route handler. */
export interface RouteContext {
    req: IncomingMessage
    res: ServerResponse
    user: CurrentUser
    params: Record<string, string>
    query: URLSearchParams
    body: unknown
}

/**
 * Route handler. A returned value other than undefined is sent as JSON with status 200,
 * unless the handler already responded (e.g. via sendJson with a custom status).
 */
export type RouteHandler = (context: RouteContext) => Promise<unknown>

interface Route {
    method: HttpMethod
    segments: string[]
    handler: RouteHandler
}

/**
 * Serialize data as JSON and finish the response.
 *
 * @param res response to write to
 * @param status HTTP status code
 * @param data JSON serializable payload
 */
export function sendJson(res: ServerResponse, status: number, data: unknown): void {
    const payload = JSON.stringify(data)
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Length', Buffer.byteLength(payload))
    res.end(payload)
}

/**
 * Validate a single path parameter according to its name.
 *
 * @throws HttpError 400 when the value does not match the expected format
 */
function validateParam(name: string, value: string): void {
    const valid = name === 'sha' ? COMMIT_ID_PATTERN.test(value) : isSafeId(value)
    if (!valid) {
        throw new HttpError(400, `Neplatný parametr ${name}`)
    }
}

function decodeSegment(segment: string): string {
    try {
        return decodeURIComponent(segment)
    } catch {
        throw new HttpError(400, 'Neplatná adresa')
    }
}

function splitPath(pathname: string): string[] {
    return pathname.split('/').filter((segment) => segment.length > 0)
}

function matchSegments(pattern: string[], actual: string[]): Record<string, string> | null {
    if (pattern.length !== actual.length) {
        return null
    }
    const params: Record<string, string> = {}
    for (let index = 0; index < pattern.length; index += 1) {
        const expected = pattern[index] ?? ''
        const value = actual[index] ?? ''
        if (expected.startsWith(':')) {
            params[expected.slice(1)] = value
        } else if (expected !== value) {
            return null
        }
    }
    return params
}

function isJsonContentType(header: string | undefined): boolean {
    const mediaType = (header ?? '').split(';')[0]?.trim().toLowerCase()
    return mediaType === 'application/json'
}

function hasBody(req: IncomingMessage): boolean {
    const length = Number(req.headers['content-length'] ?? '0')
    return length > 0 || req.headers['transfer-encoding'] !== undefined
}

/**
 * Read and parse a JSON request body with a size limit.
 *
 * @throws HttpError 413 when too large, 415 when not JSON, 400 when malformed
 */
export async function readJsonBody(req: IncomingMessage, limit: number = MAX_BODY_BYTES): Promise<unknown> {
    const contentType = req.headers['content-type']
    if (contentType !== undefined && !isJsonContentType(contentType)) {
        throw new HttpError(415, 'Požadavek musí mít Content-Type application/json')
    }
    if (!hasBody(req)) {
        return {}
    }
    if (!isJsonContentType(contentType)) {
        throw new HttpError(415, 'Požadavek musí mít Content-Type application/json')
    }
    if (Number(req.headers['content-length'] ?? '0') > limit) {
        throw new HttpError(413, 'Požadavek je příliš velký')
    }
    const chunks: Buffer[] = []
    let received = 0
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
        received += buffer.length
        if (received > limit) {
            throw new HttpError(413, 'Požadavek je příliš velký')
        }
        chunks.push(buffer)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    if (text.trim() === '') {
        return {}
    }
    try {
        return JSON.parse(text) as unknown
    } catch {
        throw new HttpError(400, 'Neplatný JSON')
    }
}

/**
 * Send an error response; unknown errors are logged and reported generically.
 */
export function sendError(res: ServerResponse, error: unknown): void {
    if (error instanceof HttpError) {
        if (!res.headersSent) {
            if (error.status === 413) {
                res.setHeader('Connection', 'close')
            }
            sendJson(res, error.status, { error: error.message })
        }
        return
    }
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
    logger.error('Request handler failed', { error: detail })
    if (!res.headersSent) {
        sendJson(res, 500, { error: GENERIC_ERROR })
    } else {
        res.destroy()
    }
}

/** Minimal method + path pattern router for the JSON API. */
export class Router {
    private readonly routes: Route[] = []

    /**
     * Register a route, e.g. `add('GET', '/api/chats/:id', handler)`.
     * Parameters named `sha` must be commit ids, all others safe ids.
     */
    add(method: HttpMethod, pattern: string, handler: RouteHandler): this {
        this.routes.push({ method, segments: splitPath(pattern), handler })
        return this
    }

    /**
     * Dispatch a request. Returns false when no route matches the path (caller sends 404).
     * Errors are converted to JSON `{error}` responses.
     */
    async handle(req: IncomingMessage, res: ServerResponse, user: CurrentUser): Promise<boolean> {
        try {
            const url = new URL(req.url ?? '/', 'http://localhost')
            const actual = splitPath(url.pathname).map(decodeSegment)
            const candidates = this.routes
                .map((route) => ({ route, params: matchSegments(route.segments, actual) }))
                .filter((match) => match.params !== null)
            if (candidates.length === 0) {
                return false
            }
            const selected = candidates.find((match) => match.route.method === req.method)
            if (selected === undefined || selected.params === null) {
                res.setHeader('Allow', [...new Set(candidates.map((match) => match.route.method))].join(', '))
                throw new HttpError(405, 'Metoda není povolena')
            }
            for (const [name, value] of Object.entries(selected.params)) {
                validateParam(name, value)
            }
            const body = BODY_METHODS.has(req.method ?? '') ? await readJsonBody(req) : null
            const result = await selected.route.handler({
                req,
                res,
                user,
                params: selected.params,
                query: url.searchParams,
                body,
            })
            if (result !== undefined && !res.headersSent && !res.writableEnded) {
                sendJson(res, 200, result)
            }
        } catch (error) {
            sendError(res, error)
        }
        return true
    }
}
