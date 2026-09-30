/**
 * Minimal HTTP helper for calls the JSON SupervisorClient does not cover
 * (plain text logs, raw REST passthrough, long running backups).
 */
import { ToolError } from './cli.js'

/** Supported HTTP methods. */
export type HttpMethod = 'GET' | 'POST'

/** Raw request description; `path` is relative to the supervisor base URL. */
export interface RawRequest {
    method: HttpMethod
    path: string
    body?: unknown
    accept?: string
    timeoutMs?: number
}

/** Raw response. */
export interface RawResponse {
    status: number
    contentType: string
    text: string
}

const DEFAULT_TIMEOUT_MS = 60_000
const ERROR_BODY_LIMIT = 2_000

/** Removes every occurrence of the secret from text. */
export function redactSecret(text: string, secret: string): string {
    return secret === '' ? text : text.split(secret).join('***')
}

/** HTTP client against the Supervisor (and Core via `/core/...`). */
export class RawHttp {
    private readonly baseUrl: string
    private readonly token: string

    constructor(baseUrl: string, token: string) {
        this.baseUrl = baseUrl.replace(/\/+$/, '')
        this.token = token
    }

    /**
     * Performs a request and returns status and body text (never throws on HTTP status).
     *
     * @throws {ToolError} on network errors or timeout
     */
    async request(request: RawRequest): Promise<RawResponse> {
        const headers: Record<string, string> = {
            Authorization: `Bearer ${this.token}`,
            Accept: request.accept ?? 'application/json',
        }
        const init: RequestInit = {
            method: request.method,
            headers,
            signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        }
        if (request.body !== undefined) {
            headers['Content-Type'] = 'application/json'
            init.body = JSON.stringify(request.body)
        }
        try {
            const response = await fetch(`${this.baseUrl}${request.path}`, init)
            return {
                status: response.status,
                contentType: response.headers.get('content-type') ?? '',
                text: await response.text(),
            }
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            throw new ToolError(`Request ${request.method} ${request.path} failed: ${redactSecret(reason, this.token)}`)
        }
    }

    /**
     * Fetches text and throws on non-2xx.
     *
     * @throws {ToolError} on HTTP errors
     */
    async text(path: string, accept = 'text/plain'): Promise<string> {
        const response = await this.request({ method: 'GET', path, accept })
        this.assertOk(response, 'GET', path)
        return response.text
    }

    /**
     * Calls a supervisor JSON endpoint and unwraps `{result: 'ok', data}`.
     *
     * @throws {ToolError} on HTTP or API errors
     */
    async supervisorJson(request: RawRequest): Promise<unknown> {
        const response = await this.request(request)
        this.assertOk(response, request.method, request.path)
        const parsed = parseJsonBody(response.text)
        if (parsed === null || typeof parsed !== 'object') {
            return parsed
        }
        const envelope = parsed as { result?: unknown, data?: unknown, message?: unknown }
        if (envelope.result === 'error') {
            const detail = typeof envelope.message === 'string' ? envelope.message : 'unknown error'
            throw new ToolError(`${request.method} ${request.path} failed: ${redactSecret(detail, this.token)}`)
        }
        return 'data' in envelope ? envelope.data : parsed
    }

    /**
     * Throws a ToolError for non-2xx responses.
     *
     * @throws {ToolError} on HTTP errors
     */
    assertOk(response: RawResponse, method: string, path: string): void {
        if (response.status >= 200 && response.status < 300) {
            return
        }
        const body = redactSecret(response.text.slice(0, ERROR_BODY_LIMIT), this.token)
        throw new ToolError(`${method} ${path} returned HTTP ${response.status}: ${body}`)
    }
}

/** Parses JSON body text, returning the raw text when it is not JSON. */
export function parseJsonBody(text: string): unknown {
    if (text.trim() === '') {
        return null
    }
    try {
        return JSON.parse(text) as unknown
    } catch {
        return text
    }
}
