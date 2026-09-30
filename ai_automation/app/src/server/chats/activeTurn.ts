import type { AnswerQuestionRequest } from '../../shared/api.js'
import {
    buildUserInputResponse,
    mapRequestUserInput,
} from '../codex/eventMapper.js'
import { newId } from '../util/ids.js'
import {
    nowIso,
    type QuestionEntry,
} from './chatEntries.js'
import { ChatConflictError } from './chatErrors.js'
import type { LiveChat } from './liveChat.js'
import type { UserInputTarget } from './serverRequests.js'
import { sanitizeQuestionAnswers } from './staleQuestions.js'
import type { TurnSession } from './turnSession.js'
import {
    asRecord,
    readString,
} from './unknownValue.js'

interface PendingQuestion {
    entry: QuestionEntry
    secretIds: Set<string>
    resolve: (response: unknown) => void
    reject: (error: Error) => void
}

const SECRET_MASK = '••••••'

function secretQuestionIds(params: unknown): Set<string> {
    const questions = asRecord(params)?.questions
    const ids = new Set<string>()
    if (Array.isArray(questions)) {
        for (const question of questions) {
            const questionId = readString(question, 'id')
            if (questionId !== null && asRecord(question)?.isSecret === true) {
                ids.add(questionId)
            }
        }
    }
    return ids
}

/**
 * State of the turn currently executed for one chat: the running TurnSession,
 * user interruption and open questions forwarded from Codex.
 */
export class ActiveTurn implements UserInputTarget {
    /** Codex thread of the chat once known. */
    public threadId: string | null = null
    private turn: TurnSession | null = null
    private interrupted = false
    private readonly pending = new Map<string, PendingQuestion>()

    /**
     * @param live chat being worked on
     */
    public constructor(public readonly live: LiveChat) {
    }

    /** Whether the user asked to stop this turn. */
    public get isInterrupted(): boolean {
        return this.interrupted
    }

    /**
     * Sets the TurnSession currently running (null between turns).
     *
     * @param turn running turn session
     */
    public attachTurn(turn: TurnSession | null): void {
        this.turn = turn
        if (turn !== null && this.interrupted) {
            void turn.interrupt()
        }
    }

    /** Stops the turn: cancels open questions and interrupts Codex. */
    public async interrupt(): Promise<void> {
        this.interrupted = true
        this.cancelQuestions('Uživatel úlohu přerušil')
        await this.turn?.interrupt()
    }

    /**
     * Shows Codex questions in the chat and waits for the answer.
     *
     * @param params raw `item/tool/requestUserInput` params
     * @returns app-server response with answers per question id
     * @throws Error when the request is malformed or the turn is interrupted
     */
    public askUser(params: unknown): Promise<unknown> {
        const questions = mapRequestUserInput(params)
        if (questions === null || questions.length === 0) {
            return Promise.reject(new Error('Invalid user input request'))
        }
        if (this.interrupted) {
            return Promise.reject(new Error('Turn was interrupted'))
        }
        const entry: QuestionEntry = {
            id: newId(),
            at: nowIso(),
            kind: 'question',
            requestId: newId(),
            questions,
            answered: false,
            answers: null,
        }
        return new Promise<unknown>((resolve, reject) => {
            this.pending.set(entry.requestId, { entry, secretIds: secretQuestionIds(params), resolve, reject })
            this.live.putEntry(entry)
            this.live.setStatus('waitingForUser')
            void this.live.flush()
        })
    }

    /**
     * Whether a question with this request id is waiting for an answer in this turn.
     *
     * @param requestId question request id
     * @returns true when open
     */
    public hasPendingQuestion(requestId: string): boolean {
        return this.pending.has(requestId)
    }

    /**
     * Delivers the user's answers to the waiting Codex request.
     *
     * @param request answers keyed by question id
     * @throws ChatConflictError when the question is not open
     */
    public answer(request: AnswerQuestionRequest): void {
        const pending = this.pending.get(request.requestId)
        if (pending === undefined) {
            throw new ChatConflictError('Tato otázka už není otevřená')
        }
        this.pending.delete(request.requestId)
        const answers = sanitizeQuestionAnswers(pending.entry, request.answers)
        const storedAnswers: Record<string, string[]> = {}
        for (const [questionId, values] of Object.entries(answers)) {
            storedAnswers[questionId] = pending.secretIds.has(questionId) ? values.map(() => SECRET_MASK) : values
        }
        this.live.putEntry({ ...pending.entry, answered: true, answers: storedAnswers })
        if (this.pending.size === 0) {
            this.live.setStatus('running')
        }
        pending.resolve(buildUserInputResponse(answers))
    }

    /**
     * Rejects all open questions (turn ended or interrupted) and closes them in the chat.
     *
     * @param reason message sent back to Codex
     */
    public cancelQuestions(reason: string): void {
        for (const pending of this.pending.values()) {
            this.live.putEntry({ ...pending.entry, answered: true, answers: null })
            pending.reject(new Error(reason))
        }
        this.pending.clear()
    }
}
