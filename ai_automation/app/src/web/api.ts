import type {
    AccountState,
    AnswerQuestionRequest,
    ChatDetail,
    ChatSummary,
    LoginMethod,
    ConfigCheckResult,
    MeResponse,
    ModelOption,
    RestoreResult,
    SendMessageRequest,
    UserSettings,
    VersionDetail,
    VersionListResponse,
} from '../shared/api'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

interface OkResponse {
    ok: true
}

/** Error thrown by the API client; `message` is always user-presentable Czech text. */
export class ApiError extends Error {
    constructor(message: string, readonly status: number) {
        super(message)
        this.name = 'ApiError'
    }
}

/**
 * Extracts a user-facing message from any thrown value.
 */
export function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message
    }
    return 'Nastala neočekávaná chyba.'
}

function readErrorBody(body: unknown, status: number): string {
    if (typeof body === 'object' && body !== null && 'error' in body) {
        const message = (body as { error: unknown }).error
        if (typeof message === 'string' && message.trim()) {
            return message
        }
    }
    return `Server odpověděl chybou (HTTP ${status}).`
}

async function request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' }
    if (body !== undefined) {
        init.headers = { ...init.headers, 'Content-Type': 'application/json' }
        init.body = JSON.stringify(body)
    } else if (method !== 'GET') {
        init.headers = { ...init.headers, 'Content-Type': 'application/json' }
        init.body = '{}'
    }
    let response: Response
    try {
        response = await fetch(path, init)
    } catch {
        throw new ApiError('Nepodařilo se spojit se serverem. Zkontrolujte připojení.', 0)
    }
    const text = await response.text()
    let parsed: unknown = null
    if (text) {
        try {
            parsed = JSON.parse(text)
        } catch {
            parsed = null
        }
    }
    if (!response.ok) {
        throw new ApiError(readErrorBody(parsed, response.status), response.status)
    }
    return parsed as T
}

function segment(value: string): string {
    return encodeURIComponent(value)
}

/** Typed client for the add-on REST API. All URLs are relative to support ingress. */
export const api = {
    me: () => request<MeResponse>('GET', 'api/me'),
    startLogin: (method: LoginMethod) => request<AccountState>('POST', 'api/account/login', { method }),
    completeBrowserLogin: (callbackUrl: string) =>
        request<AccountState>('POST', 'api/account/login/callback', { callbackUrl }),
    cancelLogin: () => request<AccountState>('POST', 'api/account/login/cancel'),
    logout: () => request<AccountState>('POST', 'api/account/logout'),
    models: () => request<ModelOption[]>('GET', 'api/models'),
    saveSettings: (settings: UserSettings) => request<UserSettings>('PUT', 'api/settings', settings),
    listChats: () => request<ChatSummary[]>('GET', 'api/chats'),
    createChat: (title?: string) => request<ChatDetail>('POST', 'api/chats', title ? { title } : {}),
    getChat: (chatId: string) => request<ChatDetail>('GET', `api/chats/${segment(chatId)}`),
    renameChat: (chatId: string, title: string) =>
        request<ChatSummary>('PATCH', `api/chats/${segment(chatId)}`, { title }),
    deleteChat: (chatId: string) => request<OkResponse>('DELETE', `api/chats/${segment(chatId)}`),
    sendMessage: (chatId: string, body: SendMessageRequest) =>
        request<OkResponse>('POST', `api/chats/${segment(chatId)}/messages`, body),
    interrupt: (chatId: string) => request<OkResponse>('POST', `api/chats/${segment(chatId)}/interrupt`),
    answer: (chatId: string, body: AnswerQuestionRequest) =>
        request<OkResponse>('POST', `api/chats/${segment(chatId)}/answers`, body),
    history: (limit: number, cursor: string | null) => {
        const query = new URLSearchParams({ limit: String(limit) })
        if (cursor) {
            query.set('cursor', cursor)
        }
        return request<VersionListResponse>('GET', `api/history?${query.toString()}`)
    },
    version: (versionId: string) => request<VersionDetail>('GET', `api/history/${segment(versionId)}`),
    restore: (versionId: string) => request<RestoreResult>('POST', `api/history/${segment(versionId)}/restore`),
    checkConfig: () => request<ConfigCheckResult>('POST', 'api/system/check-config'),
    restart: () => request<OkResponse>('POST', 'api/system/restart'),
}
