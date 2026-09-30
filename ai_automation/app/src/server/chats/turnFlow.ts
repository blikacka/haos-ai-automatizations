import type {
    ChatEntry,
    CurrentUser,
} from '../../shared/api.js'
import { logger } from '../util/logger.js'
import type { ActiveTurn } from './activeTurn.js'
import {
    errorEntry,
    findEntry,
    finishStreaming,
} from './chatEntries.js'
import { buildDeveloperInstructions } from './developerInstructions.js'
import type { LiveChat } from './liveChat.js'
import type {
    ChatConfigGuard,
    ChatEventPublisher,
    ChatHistory,
    ChatSession,
    ChatSessionPool,
} from './ports.js'
import {
    createServerRequestHandler,
    type UserInputTargetResolver,
} from './serverRequests.js'
import {
    TurnSession,
    type TurnOutcome,
} from './turnSession.js'
import {
    errorMessage,
    readRecord,
    readString,
} from './unknownValue.js'
import { VerificationFlow } from './verificationFlow.js'

/** Dependencies of the turn flow. */
export interface TurnFlowDeps {
    pool: ChatSessionPool
    hub: ChatEventPublisher
    history: ChatHistory
    guard: ChatConfigGuard
    haConfigDir: string
    turnTimeoutMs: number
    resolveTarget: UserInputTargetResolver
}

/** What the user asked for in one message. */
export interface TurnInput {
    text: string
    model: string | null
    effort: string | null
}

const TIMEOUT_MESSAGE = 'Úloha překročila časový limit a byla přerušena.'

/** Executes one complete chat turn (SPEC turn flow steps 2–6); must run inside the global mutex. */
export class TurnFlow {
    private readonly verification: VerificationFlow
    private readonly sessionsWithHandler = new WeakSet<ChatSession>()

    /**
     * @param deps collaborating services and limits
     */
    public constructor(private readonly deps: TurnFlowDeps) {
        this.verification = new VerificationFlow(deps.history, deps.guard, deps.hub)
    }

    /**
     * Runs the turn, verification and cleanup. Never rejects; failures end as error entries.
     *
     * @param active active turn state of the chat
     * @param user HA user
     * @param input message text and model overrides
     */
    public async execute(active: ActiveTurn, user: CurrentUser, input: TurnInput): Promise<void> {
        const live = active.live
        let succeeded = false
        this.deps.pool.markBusy(user.id, true)
        try {
            live.setStatus('running')
            const session = await this.deps.pool.get(user.id)
            this.installHandler(session)
            await this.captureManualChanges()
            const baseVersionId = await this.deps.history.currentVersionId()
            const threadId = await this.ensureThread(session, live, user, input)
            active.threadId = threadId
            const outcome = await this.runTurn(session, active, threadId, input)
            const configValid = await this.verification.run({
                live,
                user,
                prompt: input.text,
                baseVersionId,
                allowRepair: !active.isInterrupted,
                runRepairTurn: async (prompt) => {
                    await this.runTurn(session, active, threadId, { ...input, text: prompt })
                },
            })
            succeeded = configValid && outcome.status !== 'failed'
        } catch (error) {
            logger.error('Chat turn failed', { chatId: live.chat.id, error: errorMessage(error) })
            live.putEntry(errorEntry(`Úloha selhala: ${errorMessage(error)}`))
        } finally {
            active.cancelQuestions('Úloha skončila')
            finishStreaming(live.chat.entries).forEach((entry) => live.putEntry(entry))
            this.deps.pool.markBusy(user.id, false)
            live.setStatus(succeeded ? 'idle' : 'error')
            await live.flush()
        }
    }

    private installHandler(session: ChatSession): void {
        if (this.sessionsWithHandler.has(session)) {
            return
        }
        session.setServerRequestHandler(createServerRequestHandler(this.deps.resolveTarget))
        this.sessionsWithHandler.add(session)
    }

    private async captureManualChanges(): Promise<void> {
        const manual = await this.deps.history.snapshot({ kind: 'manual', title: 'Změny provedené mimo AI' })
        if (manual !== null) {
            this.deps.hub.broadcast({ type: 'history.updated' })
        }
    }

    private async ensureThread(
        session: ChatSession,
        live: LiveChat,
        user: CurrentUser,
        input: TurnInput,
    ): Promise<string> {
        const common: Record<string, unknown> = {
            cwd: this.deps.haConfigDir,
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
            developerInstructions: buildDeveloperInstructions({
                userName: user.displayName || user.name,
                haConfigDir: this.deps.haConfigDir,
            }),
        }
        if (input.model !== null) {
            common.model = input.model
        }
        const existingThreadId = live.chat.threadId
        if (existingThreadId !== null) {
            try {
                await session.request('thread/resume', { ...common, threadId: existingThreadId })
                return existingThreadId
            } catch (error) {
                logger.warn('thread/resume failed, starting a new thread', { error: errorMessage(error) })
            }
        }
        const startParams = input.effort === null ? common : {
            ...common,
            config: { model_reasoning_effort: input.effort },
        }
        const response = await session.request<unknown>('thread/start', startParams)
        const threadId = readString(readRecord(response, 'thread'), 'id')
        if (threadId === null) {
            throw new Error('Codex nevrátil identifikátor vlákna')
        }
        live.chat.threadId = threadId
        live.scheduleSave()
        return threadId
    }

    private async runTurn(
        session: ChatSession,
        active: ActiveTurn,
        threadId: string,
        input: TurnInput,
    ): Promise<TurnOutcome> {
        const live = active.live
        const turn = new TurnSession({
            session,
            haConfigDir: this.deps.haConfigDir,
            timeoutMs: this.deps.turnTimeoutMs,
            listener: {
                onItem: (entry, completed) => this.applyItem(live, entry, completed),
                onDelta: (itemId, delta) => live.appendDelta(itemId, delta),
                onError: (message) => live.putEntry(errorEntry(message)),
            },
        })
        active.attachTurn(turn)
        try {
            const outcome = await turn.run({ threadId, text: input.text, model: input.model, effort: input.effort })
            if (outcome.timedOut) {
                live.putEntry(errorEntry(TIMEOUT_MESSAGE))
            }
            return outcome
        } finally {
            active.attachTurn(null)
        }
    }

    private applyItem(live: LiveChat, entry: ChatEntry, completed: boolean): void {
        if (entry.kind !== 'assistant') {
            live.putEntry(entry)
            return
        }
        const existing = findEntry(live.chat.entries, entry.id)
        const streamedText = existing?.kind === 'assistant' ? existing.text : ''
        const preferMapped = entry.text !== '' && (completed || entry.text.length >= streamedText.length)
        const text = preferMapped ? entry.text : streamedText
        live.putEntry({ ...entry, text, streaming: !completed })
    }
}
