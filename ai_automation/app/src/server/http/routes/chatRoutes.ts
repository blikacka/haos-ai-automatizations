import type {
    AnswerQuestionRequest,
    ChatDetail,
    ChatSummary,
    ChatStatus,
    CurrentUser,
    SendMessageRequest,
    ServerEvent,
} from '../../../shared/api.js'
import {
    type ChatStore,
    type StoredChat,
    toSummary,
} from '../../chats/chatStore.js'
import { logger } from '../../util/logger.js'
import {
    HttpError,
    type Router,
    sendJson,
} from '../router.js'
import {
    MAX_SHORT_TEXT,
    MAX_TITLE_LENGTH,
    optionalString,
    requireObject,
    requireString,
} from '../validation.js'

/** Maximum length of a user message. */
export const MAX_MESSAGE_LENGTH = 20_000

const MAX_REQUEST_ID_LENGTH = 128
const MAX_ANSWER_KEYS = 50
const MAX_ANSWERS_PER_QUESTION = 20
const MAX_ANSWER_LENGTH = 5_000
const BUSY_STATUSES: ReadonlySet<ChatStatus> = new Set<ChatStatus>(['queued', 'running', 'verifying'])

/** Subset of ChatRunner used by the chat routes. */
export interface ChatRunnerPort {
    sendMessage(user: CurrentUser, chatId: string, request: SendMessageRequest): Promise<void>
    interrupt(user: CurrentUser, chatId: string): Promise<void>
    answer(user: CurrentUser, chatId: string, request: AnswerQuestionRequest): Promise<void>
    rename(user: CurrentUser, chatId: string, title: string): Promise<ChatSummary>
}

/** Dependencies of the chat routes. */
export interface ChatRouteDeps {
    store: ChatStore
    runner: ChatRunnerPort
    hub: { publish(userId: string, event: ServerEvent): void }
}

function toDetail(chat: StoredChat): ChatDetail {
    return { ...toSummary(chat), entries: chat.entries }
}

async function requireChat(store: ChatStore, user: CurrentUser, chatId: string): Promise<StoredChat> {
    const chat = await store.get(user.id, chatId)
    if (chat === null) {
        throw new HttpError(404, 'Chat nenalezen')
    }
    return chat
}

/**
 * Run a runner action and convert its failures to 409 Conflict with the runner message.
 */
async function runnerAction(action: () => Promise<void>, description: string): Promise<void> {
    await runnerCall(action, description)
}

/** Run a runner call and translate its errors to HttpError (ChatError statusCode is kept). */
async function runnerCall<T>(action: () => Promise<T>, description: string): Promise<T> {
    try {
        return await action()
    } catch (error) {
        const statusCode = (error as { statusCode?: unknown }).statusCode
        if (error instanceof Error && typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
            throw new HttpError(statusCode, error.message.slice(0, 500))
        }
        if (error instanceof HttpError) {
            throw error
        }
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`${description} failed`, { error: message })
        throw new HttpError(409, message.slice(0, 500) || 'Akci nelze provést')
    }
}

/**
 * Validate a SendMessageRequest body.
 *
 * @throws HttpError 400 on invalid input
 */
export function parseSendMessage(body: unknown): SendMessageRequest {
    const input = requireObject(body)
    return {
        text: requireString(input, 'text', MAX_MESSAGE_LENGTH),
        model: optionalString(input, 'model', MAX_SHORT_TEXT),
        effort: optionalString(input, 'effort', MAX_SHORT_TEXT),
    }
}

function parseAnswerList(questionId: string, value: unknown): string[] {
    if (!Array.isArray(value) || value.length > MAX_ANSWERS_PER_QUESTION) {
        throw new HttpError(400, `Neplatné odpovědi pro otázku ${questionId.slice(0, 64)}`)
    }
    return value.map((answer) => {
        if (typeof answer !== 'string' || answer.length > MAX_ANSWER_LENGTH) {
            throw new HttpError(400, 'Odpověď musí být text do 5000 znaků')
        }
        return answer
    })
}

/**
 * Validate an AnswerQuestionRequest body.
 *
 * @throws HttpError 400 on invalid input
 */
export function parseAnswer(body: unknown): AnswerQuestionRequest {
    const input = requireObject(body)
    const requestId = requireString(input, 'requestId', MAX_REQUEST_ID_LENGTH)
    const rawAnswers = requireObject(input.answers)
    const keys = Object.keys(rawAnswers)
    if (keys.length === 0 || keys.length > MAX_ANSWER_KEYS) {
        throw new HttpError(400, 'Neplatný počet odpovědí')
    }
    const answers: Record<string, string[]> = Object.create(null) as Record<string, string[]>
    for (const key of keys) {
        if (key.length > MAX_REQUEST_ID_LENGTH) {
            throw new HttpError(400, 'Neplatné id otázky')
        }
        answers[key] = parseAnswerList(key, rawAnswers[key])
    }
    return { requestId, answers }
}

function registerCrud(router: Router, deps: ChatRouteDeps): void {
    router.add('GET', '/api/chats', async ({ user }) => deps.store.list(user.id))

    router.add('POST', '/api/chats', async ({ user, body }) => {
        const title = optionalString(requireObject(body), 'title', MAX_TITLE_LENGTH)
        const chat = await deps.store.create(user.id, title ?? undefined)
        deps.hub.publish(user.id, { type: 'chat.updated', chat: toSummary(chat) })
        return toDetail(chat)
    })

    router.add('GET', '/api/chats/:id', async ({ user, params }) => (
        toDetail(await requireChat(deps.store, user, params.id ?? ''))
    ))

    router.add('PATCH', '/api/chats/:id', async ({ user, params, body }) => {
        const title = requireString(requireObject(body), 'title', MAX_TITLE_LENGTH)
        const chatId = params.id ?? ''
        await requireChat(deps.store, user, chatId)
        return runnerCall(() => deps.runner.rename(user, chatId, title), 'Rename chat')
    })

    router.add('DELETE', '/api/chats/:id', async ({ user, params }) => {
        const chatId = params.id ?? ''
        const chat = await requireChat(deps.store, user, chatId)
        if (BUSY_STATUSES.has(chat.status)) {
            throw new HttpError(409, 'Chat právě pracuje, nejdříve jej zastavte')
        }
        if (!await deps.store.delete(user.id, chatId)) {
            throw new HttpError(404, 'Chat nenalezen')
        }
        deps.hub.publish(user.id, { type: 'chat.deleted', chatId })
        return { ok: true }
    })
}

function registerActions(router: Router, deps: ChatRouteDeps): void {
    router.add('POST', '/api/chats/:id/messages', async ({ user, params, body, res }) => {
        const request = parseSendMessage(body)
        const chatId = params.id ?? ''
        await requireChat(deps.store, user, chatId)
        await runnerAction(() => deps.runner.sendMessage(user, chatId, request), 'Send message')
        sendJson(res, 202, { ok: true })
    })

    router.add('POST', '/api/chats/:id/interrupt', async ({ user, params }) => {
        const chatId = params.id ?? ''
        await requireChat(deps.store, user, chatId)
        await runnerAction(() => deps.runner.interrupt(user, chatId), 'Interrupt')
        return { ok: true }
    })

    router.add('POST', '/api/chats/:id/answers', async ({ user, params, body }) => {
        const request = parseAnswer(body)
        const chatId = params.id ?? ''
        await requireChat(deps.store, user, chatId)
        await runnerAction(() => deps.runner.answer(user, chatId, request), 'Answer')
        return { ok: true }
    })
}

/**
 * Register chat CRUD and chat action routes.
 */
export function register(router: Router, deps: ChatRouteDeps): void {
    registerCrud(router, deps)
    registerActions(router, deps)
}
