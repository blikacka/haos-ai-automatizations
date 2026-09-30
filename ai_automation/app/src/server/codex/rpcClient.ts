import {
    spawn,
    type ChildProcessWithoutNullStreams,
} from 'node:child_process'
import { EventEmitter } from 'node:events'
import { logger } from '../util/logger.js'
import {
    JSON_RPC_ERRORS,
    type JsonRpcErrorObject,
    type RequestId,
} from './protocol.js'

/** Handler for requests sent by the server to the client; the resolved value becomes the result. */
export type ServerRequestHandler = (method: string, params: unknown) => Promise<unknown>

/** Default request timeout. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000

/** Timeout for short account / model requests. */
export const SHORT_REQUEST_TIMEOUT_MS = 30_000

/** Maximal length of one incoming line; longer lines are dropped (protects memory). */
const MAX_LINE_LENGTH = 64 * 1024 * 1024
const STOP_GRACE_MS = 5_000
const LOG_PREVIEW_LENGTH = 200

interface PendingRequest {
    method: string
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
}

/** Error returned by the server in a JSON-RPC error response. */
export class JsonRpcError extends Error {
    public readonly code: number
    public readonly data: unknown

    /**
     * @param error error object from the response
     */
    public constructor(error: JsonRpcErrorObject) {
        super(error.message)
        this.name = 'JsonRpcError'
        this.code = error.code
        this.data = error.data
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRequestId(value: unknown): value is RequestId {
    return typeof value === 'string' || typeof value === 'number'
}

function toErrorObject(value: unknown): JsonRpcErrorObject {
    if (isRecord(value) && typeof value.message === 'string') {
        return {
            code: typeof value.code === 'number' ? value.code : JSON_RPC_ERRORS.internalError,
            message: value.message,
            data: value.data,
        }
    }
    return { code: JSON_RPC_ERRORS.internalError, message: 'Unknown JSON-RPC error' }
}

/**
 * JSON-RPC 2.0 client talking to a child process over stdio (newline-delimited JSON).
 * Events: 'notification' (method, params), 'exit' (code: number | null).
 */
export class JsonRpcProcess extends EventEmitter {
    private child: ChildProcessWithoutNullStreams | null = null
    private running = false
    private nextId = 1
    private buffer = ''
    private readonly pending = new Map<RequestId, PendingRequest>()
    private serverRequestHandler: ServerRequestHandler | null = null
    private exitPromise: Promise<void> = Promise.resolve()

    /**
     * @param command executable to spawn (never run through a shell)
     * @param args argument array
     * @param env environment of the child
     * @param cwd working directory of the child
     */
    public constructor(
        private readonly command: string,
        private readonly args: string[],
        private readonly env: NodeJS.ProcessEnv,
        private readonly cwd: string,
    ) {
        super()
    }

    /** Whether the child process is alive. */
    public get isRunning(): boolean {
        return this.running
    }

    /** Spawns the child process; calling it on a running process is a no-op. */
    public start(): void {
        if (this.running) {
            return
        }
        const child = spawn(this.command, this.args, {
            cwd: this.cwd,
            env: this.env,
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: false,
        })
        this.child = child
        this.running = true
        this.buffer = ''
        this.exitPromise = new Promise<void>((resolveExit) => {
            let finished = false
            const finish = (code: number | null): void => {
                if (finished) {
                    return
                }
                finished = true
                this.handleExit(code)
                resolveExit()
            }
            child.once('close', (code) => finish(code))
            child.once('error', (error) => {
                logger.error('Codex process error', { command: this.command, error })
                finish(null)
            })
        })
        child.stdout.setEncoding('utf8')
        child.stdout.on('data', (chunk: string) => this.handleStdout(chunk))
        child.stderr.setEncoding('utf8')
        child.stderr.on('data', (chunk: string) => {
            logger.debug('codex stderr', { text: chunk.trimEnd().slice(0, 2000) })
        })
        child.stdin.on('error', (error) => {
            logger.warn('Codex stdin error', { error })
        })
    }

    /**
     * Sends a request and waits for its response.
     *
     * @param method JSON-RPC method
     * @param params request params
     * @param timeoutMs timeout, default 120 s
     * @returns response result
     * @throws JsonRpcError on error response, Error on timeout / process exit
     */
    public request<T>(method: string, params: unknown, timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS): Promise<T> {
        if (!this.running) {
            return Promise.reject(new Error('Codex process is not running'))
        }
        const id = this.nextId++
        return new Promise<T>((resolveRequest, rejectRequest) => {
            const timer = setTimeout(() => {
                this.pending.delete(id)
                rejectRequest(new Error(`Codex request ${method} timed out after ${timeoutMs} ms`))
            }, timeoutMs)
            this.pending.set(id, {
                method,
                resolve: (value) => resolveRequest(value as T),
                reject: rejectRequest,
                timer,
            })
            this.write({ id, method, params })
        })
    }

    /**
     * Sends a notification (no response expected).
     *
     * @param method JSON-RPC method
     * @param params optional params
     */
    public notify(method: string, params?: unknown): void {
        this.write(params === undefined ? { method } : { method, params })
    }

    /**
     * Registers the handler for server -> client requests.
     *
     * @param handler async handler; its result (or thrown error) is sent back
     */
    public setServerRequestHandler(handler: ServerRequestHandler): void {
        this.serverRequestHandler = handler
    }

    /** Stops the child (stdin close + SIGTERM, SIGKILL after 5 s) and waits for its exit. */
    public async stop(): Promise<void> {
        const child = this.child
        if (child === null || !this.running) {
            return
        }
        child.stdin.end()
        child.kill('SIGTERM')
        const killTimer = setTimeout(() => child.kill('SIGKILL'), STOP_GRACE_MS)
        try {
            await this.exitPromise
        } finally {
            clearTimeout(killTimer)
        }
    }

    private write(message: Record<string, unknown>): void {
        const child = this.child
        if (child === null || !this.running || !child.stdin.writable) {
            logger.warn('Cannot write to Codex process', { method: message.method })
            return
        }
        child.stdin.write(`${JSON.stringify(message)}\n`)
    }

    private handleStdout(chunk: string): void {
        this.buffer += chunk
        let newlineIndex = this.buffer.indexOf('\n')
        while (newlineIndex !== -1) {
            const line = this.buffer.slice(0, newlineIndex).trim()
            this.buffer = this.buffer.slice(newlineIndex + 1)
            if (line !== '') {
                this.handleLine(line)
            }
            newlineIndex = this.buffer.indexOf('\n')
        }
        if (this.buffer.length > MAX_LINE_LENGTH) {
            logger.warn('Dropping oversized line from Codex', { length: this.buffer.length })
            this.buffer = ''
        }
    }

    private handleLine(line: string): void {
        let message: unknown
        try {
            message = JSON.parse(line)
        } catch {
            logger.warn('Invalid JSON line from Codex', { line: line.slice(0, LOG_PREVIEW_LENGTH) })
            return
        }
        if (!isRecord(message)) {
            logger.warn('Unexpected message from Codex', { line: line.slice(0, LOG_PREVIEW_LENGTH) })
            return
        }
        const hasMethod = typeof message.method === 'string'
        if (hasMethod && isRequestId(message.id)) {
            void this.handleServerRequest(message.id, message.method as string, message.params)
        } else if (hasMethod) {
            this.emit('notification', message.method, message.params)
        } else if (isRequestId(message.id)) {
            this.handleResponse(message.id, message)
        } else {
            logger.warn('Unrecognized message from Codex', { line: line.slice(0, LOG_PREVIEW_LENGTH) })
        }
    }

    private handleResponse(id: RequestId, message: Record<string, unknown>): void {
        const pending = this.pending.get(id)
        if (pending === undefined) {
            logger.debug('Response for unknown request id', { id })
            return
        }
        this.pending.delete(id)
        clearTimeout(pending.timer)
        if ('error' in message && message.error !== undefined && message.error !== null) {
            pending.reject(new JsonRpcError(toErrorObject(message.error)))
        } else {
            pending.resolve(message.result)
        }
    }

    private async handleServerRequest(id: RequestId, method: string, params: unknown): Promise<void> {
        const handler = this.serverRequestHandler
        if (handler === null) {
            logger.warn('Server request without handler', { method })
            this.write({ id, error: { code: JSON_RPC_ERRORS.methodNotFound, message: `Method not found: ${method}` } })
            return
        }
        try {
            const result = await handler(method, params)
            this.write({ id, result: result ?? null })
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            this.write({ id, error: { code: JSON_RPC_ERRORS.internalError, message } })
        }
    }

    private handleExit(code: number | null): void {
        this.running = false
        this.child = null
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer)
            pending.reject(new Error('Codex process exited'))
        }
        this.pending.clear()
        logger.info('Codex process exited', { code })
        this.emit('exit', code)
    }
}
