import { EventEmitter } from 'node:events'
import { logger } from '../util/logger.js'
import {
    APPROVAL_REQUEST_METHODS,
    CODEX_METHODS,
    JSON_RPC_ERRORS,
    LEGACY_APPROVAL_REQUEST_METHODS,
    type InitializeParams,
} from './protocol.js'
import {
    JsonRpcError,
    JsonRpcProcess,
    SHORT_REQUEST_TIMEOUT_MS,
    type ServerRequestHandler,
} from './rpcClient.js'

/** Options of one Codex app-server session. */
export interface CodexSessionOptions {
    codexBin: string
    codexHome: string
    cwd: string
    env: NodeJS.ProcessEnv
    /** Version reported in clientInfo (defaults to 0.0.0). */
    clientVersion?: string
    /** Extra CLI arguments (defaults to ['app-server']). */
    args?: string[]
}

/** Client identification reported to the app-server. */
const CLIENT_NAME = 'ai_automation'
const CLIENT_TITLE = 'AI automatizace'
const DEFAULT_CLIENT_VERSION = '0.0.0'
const DEFAULT_ARGS: readonly string[] = ['app-server']

/**
 * Fallback server request handler used until the chat layer installs its own:
 * approvals are accepted (approval policy is 'never' anyway), everything else is unsupported.
 *
 * @param method server request method
 * @returns approval decision
 * @throws JsonRpcError for unsupported methods
 */
export async function defaultServerRequestHandler(method: string): Promise<unknown> {
    if (APPROVAL_REQUEST_METHODS.has(method)) {
        return { decision: 'accept' }
    }
    if (LEGACY_APPROVAL_REQUEST_METHODS.has(method)) {
        return { decision: 'approved' }
    }
    throw new JsonRpcError({ code: JSON_RPC_ERRORS.methodNotFound, message: `Unsupported request: ${method}` })
}

/**
 * One `codex app-server` process of one HA user.
 * Events: 'notification' (method, params), 'exit' (code).
 */
export class CodexSession extends EventEmitter {
    private readonly rpc: JsonRpcProcess
    private startPromise: Promise<void> | null = null

    /**
     * @param options spawn options
     */
    public constructor(private readonly options: CodexSessionOptions) {
        super()
        this.rpc = new JsonRpcProcess(
            options.codexBin,
            [...(options.args ?? DEFAULT_ARGS)],
            { ...options.env, CODEX_HOME: options.codexHome },
            options.cwd,
        )
        this.rpc.setServerRequestHandler(defaultServerRequestHandler)
        this.rpc.on('notification', (method: string, params: unknown) => {
            this.emit('notification', method, params)
        })
        this.rpc.on('exit', (code: number | null) => {
            this.startPromise = null
            this.emit('exit', code)
        })
    }

    /** Whether the underlying process is alive. */
    public get isRunning(): boolean {
        return this.rpc.isRunning
    }

    /**
     * Spawns the app-server and performs the initialize handshake (idempotent).
     *
     * @throws Error when the process cannot be started or initialize fails
     */
    public start(): Promise<void> {
        if (this.startPromise === null) {
            this.startPromise = this.initialize().catch(async (error: unknown) => {
                this.startPromise = null
                await this.rpc.stop()
                throw error
            })
        }
        return this.startPromise
    }

    /**
     * Sends a request to the app-server.
     *
     * @param method JSON-RPC method
     * @param params params
     * @param timeoutMs optional timeout
     * @returns result
     */
    public request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
        return this.rpc.request<T>(method, params, timeoutMs)
    }

    /**
     * Replaces the handler of server -> client requests.
     *
     * @param handler async handler
     */
    public setServerRequestHandler(handler: ServerRequestHandler): void {
        this.rpc.setServerRequestHandler(handler)
    }

    /** Stops the app-server process. */
    public async stop(): Promise<void> {
        this.startPromise = null
        await this.rpc.stop()
    }

    private async initialize(): Promise<void> {
        this.rpc.start()
        const params: InitializeParams = {
            clientInfo: {
                name: CLIENT_NAME,
                title: CLIENT_TITLE,
                version: this.options.clientVersion ?? DEFAULT_CLIENT_VERSION,
            },
            capabilities: null,
        }
        await this.rpc.request(CODEX_METHODS.initialize, params, SHORT_REQUEST_TIMEOUT_MS)
        this.rpc.notify(CODEX_METHODS.initialized)
        logger.info('Codex app-server started', { codexHome: this.options.codexHome })
    }
}
