import type {
    AnswerQuestionRequest,
    ChatSummary,
    CurrentUser,
    SendMessageRequest,
} from '../../shared/api.js'
import type { AppEnv } from '../config/env.js'
import { logger } from '../util/logger.js'
import { Mutex } from '../util/mutex.js'
import { ActiveTurn } from './activeTurn.js'
import { userEntry } from './chatEntries.js'
import {
    ChatConflictError,
    ChatNotFoundError,
    ChatValidationError,
} from './chatErrors.js'
import {
    validateAnswer,
    validateOption,
    validateText,
} from './chatValidation.js'
import {
    DEFAULT_CHAT_TITLE,
    MAX_TITLE_LENGTH,
    toSummary,
    type ChatStore,
} from './chatStore.js'
import { LiveChat } from './liveChat.js'
import {
    findUnansweredQuestion,
    formatAnswersAsMessage,
    sanitizeQuestionAnswers,
} from './staleQuestions.js'
import type {
    ChatConfigGuard,
    ChatEventPublisher,
    ChatHistory,
    ChatSessionPool,
} from './ports.js'
import { TurnFlow } from './turnFlow.js'
import { errorMessage } from './unknownValue.js'

/** Dependencies of the chat runner. */
export interface ChatRunnerDeps {
    store: ChatStore
    pool: ChatSessionPool
    hub: ChatEventPublisher
    history: ChatHistory
    guard: ChatConfigGuard
    env: Pick<AppEnv, 'haConfigDir'>
    /** Maximal turn duration before it is interrupted (default 30 minutes). */
    turnTimeoutMs?: number
}

const DEFAULT_TURN_TIMEOUT_MS = 30 * 60 * 1000
const AUTO_TITLE_LENGTH = 60

/**
 * Runs chat turns against Codex. One configuration-changing turn runs at a time across all users
 * (global mutex); other chats wait in status 'queued'.
 */
export class ChatRunner {
    private readonly mutex = new Mutex()
    private readonly activeTurns = new Map<string, ActiveTurn>()
    private readonly reserved = new Set<string>()
    private readonly flow: TurnFlow

    /**
     * @param deps collaborating services
     */
    public constructor(private readonly deps: ChatRunnerDeps) {
        this.flow = new TurnFlow({
            pool: deps.pool,
            hub: deps.hub,
            history: deps.history,
            guard: deps.guard,
            haConfigDir: deps.env.haConfigDir,
            turnTimeoutMs: deps.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS,
            resolveTarget: (threadId) => this.findByThread(threadId),
        })
    }

    /**
     * Records the user message and queues the turn; returns once it is queued or started.
     *
     * @param user HA user
     * @param chatId chat id
     * @param request message and model selection
     * @throws ChatValidationError, ChatNotFoundError, ChatConflictError
     */
    public async sendMessage(user: CurrentUser, chatId: string, request: SendMessageRequest): Promise<void> {
        const text = validateText(request.text)
        const requestedModel = validateOption(request.model, 'modelu')
        const requestedEffort = validateOption(request.effort, 'úrovně přemýšlení')
        const key = this.key(user.id, chatId)
        if (this.activeTurns.has(key) || this.reserved.has(key)) {
            throw new ChatConflictError('V tomto chatu už úloha probíhá')
        }
        this.reserved.add(key)
        let active: ActiveTurn
        try {
            active = await this.prepareTurn(user, chatId, text, requestedModel, requestedEffort)
            this.activeTurns.set(key, active)
        } finally {
            this.reserved.delete(key)
        }
        const turnInput = {
            text,
            model: requestedModel ?? active.live.chat.model,
            effort: requestedEffort ?? active.live.chat.effort,
        }
        active.live.setStatus(this.mutex.isLocked ? 'queued' : 'running')
        void this.mutex
            .runExclusive(async () => {
                if (active.isInterrupted) {
                    await this.cancelQueued(active)
                    return
                }
                await this.flow.execute(active, user, turnInput)
            })
            .catch((error: unknown) => {
                logger.error('Unexpected chat runner failure', { chatId, error: errorMessage(error) })
            })
            .finally(() => {
                this.activeTurns.delete(key)
            })
        await active.live.flush()
    }

    /**
     * Interrupts the running (or queued) turn of a chat. Without an active turn a stale
     * non-idle status (e.g. after an add-on restart) is reset to idle.
     *
     * @param user HA user
     * @param chatId chat id
     */
    public async interrupt(user: CurrentUser, chatId: string): Promise<void> {
        const active = this.activeTurns.get(this.key(user.id, chatId))
        if (active === undefined) {
            await this.resetStaleStatus(user, chatId)
            return
        }
        const wasQueued = active.live.chat.status === 'queued'
        await active.interrupt()
        if (wasQueued) {
            active.live.setStatus('idle')
        }
    }

    /**
     * Answers an open question. When the question can no longer reach Codex (its request vanished,
     * e.g. after a restart), it is closed and the answers are sent as a normal message in a new turn.
     *
     * @param user HA user
     * @param chatId chat id
     * @param request request id and answers
     * @throws ChatValidationError, ChatNotFoundError, ChatConflictError
     */
    public async answer(user: CurrentUser, chatId: string, request: AnswerQuestionRequest): Promise<void> {
        validateAnswer(request)
        const active = this.activeTurns.get(this.key(user.id, chatId))
        if (active?.hasPendingQuestion(request.requestId) === true) {
            active.answer(request)
            await active.live.flush()
            return
        }
        if (active !== undefined) {
            throw new ChatConflictError('Tato otázka už není otevřená')
        }
        const chat = await this.deps.store.get(user.id, chatId)
        if (chat === null) {
            throw new ChatNotFoundError()
        }
        const question = findUnansweredQuestion(chat.entries, request.requestId)
        if (question === null) {
            throw new ChatConflictError('Tato otázka už není otevřená')
        }
        const answers = sanitizeQuestionAnswers(question, request.answers)
        const live = new LiveChat(this.deps.store, this.deps.hub, user.id, chat)
        live.putEntry({ ...question, answered: true, answers })
        live.setStatus('idle')
        await live.flush()
        await this.sendMessage(user, chatId, {
            text: formatAnswersAsMessage(question, answers),
            model: null,
            effort: null,
        })
    }

    /**
     * Renames a chat; while a turn runs the in-memory chat is updated so the rename is not lost.
     *
     * @param user HA user
     * @param chatId chat id
     * @param title new title
     * @returns updated summary
     * @throws ChatValidationError, ChatNotFoundError
     */
    public async rename(user: CurrentUser, chatId: string, title: string): Promise<ChatSummary> {
        const cleanTitle = typeof title === 'string' ? title.trim().slice(0, MAX_TITLE_LENGTH) : ''
        if (cleanTitle === '') {
            throw new ChatValidationError('Název nesmí být prázdný')
        }
        const active = this.activeTurns.get(this.key(user.id, chatId))
        if (active !== undefined) {
            await active.live.rename(cleanTitle)
            return toSummary(active.live.chat)
        }
        const chat = await this.deps.store.get(user.id, chatId)
        if (chat === null) {
            throw new ChatNotFoundError()
        }
        const live = new LiveChat(this.deps.store, this.deps.hub, user.id, chat)
        await live.rename(cleanTitle)
        return toSummary(chat)
    }

    /**
     * Whether a turn currently holds the global lock.
     *
     * @returns true while any turn runs
     */
    public isBusy(): boolean {
        return this.mutex.isLocked
    }

    private async prepareTurn(
        user: CurrentUser,
        chatId: string,
        text: string,
        requestedModel: string | null,
        requestedEffort: string | null,
    ): Promise<ActiveTurn> {
        const chat = await this.deps.store.get(user.id, chatId)
        if (chat === null) {
            throw new ChatNotFoundError()
        }
        const live = new LiveChat(this.deps.store, this.deps.hub, user.id, chat)
        chat.model ??= requestedModel
        chat.effort ??= requestedEffort
        if (chat.title === DEFAULT_CHAT_TITLE) {
            chat.title = text.slice(0, AUTO_TITLE_LENGTH)
        }
        live.putEntry(userEntry(text))
        return new ActiveTurn(live)
    }

    private async resetStaleStatus(user: CurrentUser, chatId: string): Promise<void> {
        const chat = await this.deps.store.get(user.id, chatId)
        if (chat === null || chat.status === 'idle') {
            return
        }
        const live = new LiveChat(this.deps.store, this.deps.hub, user.id, chat)
        live.setStatus('idle')
        await live.flush()
    }

    private async cancelQueued(active: ActiveTurn): Promise<void> {
        active.live.setStatus('idle')
        await active.live.flush()
    }

    private findByThread(threadId: string | null): ActiveTurn | null {
        if (threadId === null) {
            return null
        }
        for (const active of this.activeTurns.values()) {
            if (active.threadId === threadId) {
                return active
            }
        }
        return null
    }

    private key(userId: string, chatId: string): string {
        return `${userId}\u0000${chatId}`
    }
}
