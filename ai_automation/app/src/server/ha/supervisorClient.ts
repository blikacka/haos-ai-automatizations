import WebSocket from 'ws'

/** HTTP methods supported by the Supervisor / Core REST APIs. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

const REST_TIMEOUT_MS = 120_000
const WS_TIMEOUT_MS = 30_000
const WS_COMMAND_ID = 1
const MAX_ERROR_TEXT = 500

/** Error returned by Supervisor / Core calls; never contains the access token. */
export class SupervisorError extends Error {
    public readonly status: number

    /**
     * @param message human readable message
     * @param status HTTP status (0 for network / websocket errors)
     */
    public constructor(message: string, status: number) {
        super(message)
        this.name = 'SupervisorError'
        this.status = status
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorText(payload: unknown, fallback: string): string {
    if (isRecord(payload) && typeof payload.message === 'string') {
        return payload.message
    }
    if (typeof payload === 'string' && payload.trim() !== '') {
        return payload.trim().slice(0, MAX_ERROR_TEXT)
    }
    return fallback
}

/** Thin client for the Home Assistant Supervisor and Core APIs (REST + one-shot WebSocket). */
export class SupervisorClient {
    private readonly baseUrl: string
    private readonly token: string

    /**
     * @param baseUrl e.g. http://supervisor
     * @param token SUPERVISOR_TOKEN
     */
    public constructor(baseUrl: string, token: string) {
        this.baseUrl = baseUrl.replace(/\/+$/, '')
        this.token = token
    }

    /**
     * Calls the Supervisor REST API and unwraps `{ result: 'ok', data }`.
     *
     * @throws SupervisorError on HTTP or API error
     */
    public async supervisor<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
        const payload = await this.request(method, path, body)
        if (isRecord(payload) && 'result' in payload) {
            if (payload.result !== 'ok') {
                throw new SupervisorError(`Supervisor ${method} ${path} failed: ${errorText(payload, 'unknown error')}`, 200)
            }
            return payload.data as T
        }
        return payload as T
    }

    /**
     * Calls the Home Assistant Core REST API through the Supervisor proxy.
     *
     * @param path path like '/api/config/core/check_config'
     * @throws SupervisorError on HTTP error
     */
    public async core<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
        return await this.request(method, `/core${path}`, body) as T
    }

    /**
     * Sends one command over the Core WebSocket API and resolves its result.
     *
     * @param message command without id (e.g. `{ type: 'config/area_registry/list' }`)
     * @throws SupervisorError on auth failure, command error, timeout or connection error
     */
    public coreWs<T>(message: Record<string, unknown>): Promise<T> {
        const url = `${this.baseUrl.replace(/^http/, 'ws')}/core/websocket`
        return new Promise<T>((resolvePromise, rejectPromise) => {
            const socket = new WebSocket(url)
            let settled = false
            const finish = (error: SupervisorError | null, result?: unknown): void => {
                if (settled) {
                    return
                }
                settled = true
                clearTimeout(timer)
                socket.removeAllListeners()
                socket.on('error', () => undefined)
                socket.terminate()
                if (error === null) {
                    resolvePromise(result as T)
                } else {
                    rejectPromise(error)
                }
            }
            const timer = setTimeout(() => {
                finish(new SupervisorError(`Core WebSocket ${String(message.type)} timed out`, 0))
            }, WS_TIMEOUT_MS)
            socket.on('message', (data: WebSocket.RawData) => {
                this.handleWsMessage(socket, data, message, finish)
            })
            socket.on('error', (error: Error) => {
                finish(new SupervisorError(`Core WebSocket error: ${error.message}`, 0))
            })
            socket.on('close', () => {
                finish(new SupervisorError('Core WebSocket closed before result', 0))
            })
        })
    }

    private handleWsMessage(
        socket: WebSocket,
        data: WebSocket.RawData,
        command: Record<string, unknown>,
        finish: (error: SupervisorError | null, result?: unknown) => void,
    ): void {
        let parsed: unknown
        try {
            parsed = JSON.parse(data.toString())
        } catch {
            finish(new SupervisorError('Core WebSocket sent invalid JSON', 0))
            return
        }
        if (!isRecord(parsed)) {
            return
        }
        switch (parsed.type) {
            case 'auth_required':
                socket.send(JSON.stringify({ type: 'auth', access_token: this.token }))
                return
            case 'auth_ok':
                socket.send(JSON.stringify({ ...command, id: WS_COMMAND_ID }))
                return
            case 'auth_invalid':
                finish(new SupervisorError(`Core WebSocket auth invalid: ${errorText(parsed, 'rejected')}`, 401))
                return
            case 'result':
                if (parsed.id !== WS_COMMAND_ID) {
                    return
                }
                if (parsed.success === true) {
                    finish(null, parsed.result)
                } else {
                    const code = isRecord(parsed.error) && typeof parsed.error.code === 'string' ? parsed.error.code : 'error'
                    finish(new SupervisorError(`Core WebSocket ${String(command.type)} failed (${code}): ${errorText(parsed.error, 'unknown error')}`, 0))
                }
                return
            default:
                return
        }
    }

    private async request(method: HttpMethod, path: string, body?: unknown): Promise<unknown> {
        if (!path.startsWith('/')) {
            throw new SupervisorError(`Invalid API path: ${path}`, 0)
        }
        const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` }
        const init: RequestInit = { method, headers, signal: AbortSignal.timeout(REST_TIMEOUT_MS) }
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json'
            init.body = JSON.stringify(body)
        }
        let response: Response
        try {
            response = await fetch(`${this.baseUrl}${path}`, init)
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            throw new SupervisorError(`${method} ${path} failed: ${reason}`, 0)
        }
        const payload = await this.readBody(response)
        if (!response.ok) {
            throw new SupervisorError(
                `${method} ${path} failed (status ${response.status}): ${errorText(payload, response.statusText)}`,
                response.status,
            )
        }
        return payload
    }

    private async readBody(response: Response): Promise<unknown> {
        const text = await response.text()
        const contentType = response.headers.get('content-type') ?? ''
        if (text === '' || !contentType.includes('json')) {
            return text
        }
        try {
            return JSON.parse(text)
        } catch {
            return text
        }
    }
}
