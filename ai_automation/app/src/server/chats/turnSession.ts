import type { ChatEntry } from '../../shared/api.js'
import { mapItemToEntry } from '../codex/eventMapper.js'
import { logger } from '../util/logger.js'
import { nowIso } from './chatEntries.js'
import type {
    ChatSession,
    ExitListener,
    NotificationListener,
} from './ports.js'
import {
    asRecord,
    errorMessage,
    readRecord,
    readString,
} from './unknownValue.js'

/** How a single turn ended. */
export type TurnEndStatus = 'completed' | 'interrupted' | 'failed'

/** Result of running one turn. */
export interface TurnOutcome {
    status: TurnEndStatus
    errorMessage: string | null
    timedOut: boolean
}

/** Receives mapped events of a running turn. */
export interface TurnListener {
    onItem(entry: ChatEntry, completed: boolean): void
    onDelta(itemId: string, delta: string): void
    onError(message: string): void
}

/** Parameters of a turn to start. */
export interface TurnRequest {
    threadId: string
    text: string
    model: string | null
    effort: string | null
}

/** Dependencies and limits of a turn session. */
export interface TurnSessionOptions {
    session: ChatSession
    haConfigDir: string
    timeoutMs: number
    listener: TurnListener
}

const INTERRUPT_GRACE_MS = 30_000
const TURN_STATUSES: readonly TurnEndStatus[] = ['completed', 'interrupted', 'failed']

/** Runs one Codex turn: starts it, streams its notifications and resolves on `turn/completed`. */
export class TurnSession {
    private currentTurnId: string | null = null
    private threadId: string | null = null
    private interruptRequested = false
    private reportedError: string | null = null
    private finish: ((outcome: TurnOutcome) => void) | null = null
    private timedOut = false

    /**
     * @param options session, config dir, timeout and listener
     */
    public constructor(private readonly options: TurnSessionOptions) {
    }

    /** Codex id of the running turn (null until known). */
    public get turnId(): string | null {
        return this.currentTurnId
    }

    /**
     * Starts the turn and waits until it completes, fails or times out.
     *
     * @param request thread, text and model overrides
     * @returns outcome (never rejects)
     */
    public async run(request: TurnRequest): Promise<TurnOutcome> {
        this.threadId = request.threadId
        const completion = new Promise<TurnOutcome>((resolveOutcome) => {
            this.finish = resolveOutcome
        })
        const listener: NotificationListener = (method, params) => this.handleNotification(method, params)
        const exitListener: ExitListener = () => this.complete('failed', 'Proces Codexu se neočekávaně ukončil.')
        this.options.session.on('notification', listener)
        this.options.session.on('exit', exitListener)
        const timers = this.startTimers()
        try {
            await this.startTurn(request)
            return await completion
        } finally {
            timers.forEach((timer) => clearTimeout(timer))
            this.options.session.off('notification', listener)
            this.options.session.off('exit', exitListener)
            this.finish = null
        }
    }

    /** Requests interruption of the turn (deferred until the turn id is known). */
    public async interrupt(): Promise<void> {
        this.interruptRequested = true
        if (this.currentTurnId === null || this.threadId === null) {
            return
        }
        try {
            await this.options.session.request('turn/interrupt', {
                threadId: this.threadId,
                turnId: this.currentTurnId,
            })
        } catch (error) {
            logger.warn('turn/interrupt failed', { error: errorMessage(error) })
        }
    }

    private startTimers(): NodeJS.Timeout[] {
        const timeoutTimer = setTimeout(() => {
            this.timedOut = true
            logger.warn('Turn timed out, interrupting', { threadId: this.threadId })
            void this.interrupt()
        }, this.options.timeoutMs)
        const hardStopTimer = setTimeout(() => {
            this.complete('interrupted', 'Codex neodpověděl včas, úloha byla přerušena.')
        }, this.options.timeoutMs + INTERRUPT_GRACE_MS)
        return [timeoutTimer, hardStopTimer]
    }

    private async startTurn(request: TurnRequest): Promise<void> {
        const params: Record<string, unknown> = {
            threadId: request.threadId,
            input: [{ type: 'text', text: request.text, text_elements: [] }],
        }
        if (request.model !== null) {
            params.model = request.model
        }
        if (request.effort !== null) {
            params.effort = request.effort
        }
        try {
            const response = await this.options.session.request<unknown>('turn/start', params)
            this.rememberTurnId(readString(readRecord(response, 'turn'), 'id'))
        } catch (error) {
            this.complete('failed', `Nepodařilo se spustit úlohu: ${errorMessage(error)}`)
        }
    }

    private rememberTurnId(turnId: string | null): void {
        if (turnId === null || this.currentTurnId !== null) {
            return
        }
        this.currentTurnId = turnId
        if (this.interruptRequested) {
            void this.interrupt()
        }
    }

    private handleNotification(method: string, params: unknown): void {
        if (readString(params, 'threadId') !== this.threadId) {
            return
        }
        try {
            this.dispatch(method, params)
        } catch (error) {
            logger.error('Failed to handle Codex notification', { method, error: errorMessage(error) })
        }
    }

    private dispatch(method: string, params: unknown): void {
        switch (method) {
            case 'turn/started':
                this.rememberTurnId(readString(readRecord(params, 'turn'), 'id'))
                break
            case 'item/started':
            case 'item/completed':
                this.handleItem(params, method === 'item/completed')
                break
            case 'item/agentMessage/delta':
                this.handleDelta(params)
                break
            case 'error':
                this.handleError(params)
                break
            case 'turn/completed':
                this.handleTurnCompleted(params)
                break
            default:
                break
        }
    }

    private handleItem(params: unknown, completed: boolean): void {
        const entry = mapItemToEntry(asRecord(params)?.item, this.options.haConfigDir, nowIso())
        if (entry !== null) {
            this.options.listener.onItem(entry, completed)
        }
    }

    private handleDelta(params: unknown): void {
        const itemId = readString(params, 'itemId')
        const delta = readString(params, 'delta')
        if (itemId !== null && delta !== null && delta !== '') {
            this.options.listener.onDelta(itemId, delta)
        }
    }

    private handleError(params: unknown): void {
        if (asRecord(params)?.willRetry === true) {
            return
        }
        const message = readString(readRecord(params, 'error'), 'message') ?? 'Neznámá chyba Codexu'
        this.reportError(message)
    }

    private handleTurnCompleted(params: unknown): void {
        const turn = readRecord(params, 'turn')
        const rawStatus = readString(turn, 'status')
        const status = TURN_STATUSES.find((candidate) => candidate === rawStatus) ?? 'completed'
        const message = readString(readRecord(turn, 'error'), 'message')
        if (status === 'failed') {
            this.reportError(message ?? 'Úloha selhala')
        }
        this.complete(status, message)
    }

    private reportError(message: string): void {
        if (this.reportedError === message) {
            return
        }
        this.reportedError = message
        this.options.listener.onError(message)
    }

    private complete(status: TurnEndStatus, message: string | null): void {
        const finish = this.finish
        if (finish === null) {
            return
        }
        this.finish = null
        if (status === 'failed' && message !== null) {
            this.reportError(message)
        }
        finish({ status, errorMessage: message ?? this.reportedError, timedOut: this.timedOut })
    }
}
