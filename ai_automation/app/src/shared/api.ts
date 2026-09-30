/**
 * Shared API contract between the add-on server and the web UI.
 * Every REST payload and WebSocket event is described here.
 */

/** Home Assistant user resolved from ingress headers. */
export interface CurrentUser {
    id: string
    name: string
    displayName: string
}

/** Codex (ChatGPT) account state of the current HA user. */
export type AccountState =
    | { status: 'loggedOut' }
    | { status: 'pendingLogin', loginId: string, verificationUrl: string, userCode: string }
    | { status: 'pendingBrowserLogin', loginId: string, authUrl: string }
    | { status: 'loggedIn', email: string | null, planType: string | null }

/**
 * How the user logs in: `deviceCode` (one-time code entered at OpenAI) or `browser`
 * (OAuth in the browser; the final localhost callback address is pasted back into the add-on).
 */
export type LoginMethod = 'deviceCode' | 'browser'

export interface StartLoginRequest {
    method: LoginMethod
}

export interface CompleteBrowserLoginRequest {
    /** Full address from the browser address bar after login (http://localhost:1455/auth/callback?code=…&state=…). */
    callbackUrl: string
}

export interface MeResponse {
    user: CurrentUser
    account: AccountState
    settings: UserSettings
    addonVersion: string
}

export interface UserSettings {
    model: string | null
    effort: string | null
}

export interface EffortOption {
    id: string
    description: string
}

export interface ModelOption {
    id: string
    displayName: string
    description: string
    isDefault: boolean
    efforts: EffortOption[]
    defaultEffort: string
}

export type ChatStatus = 'idle' | 'queued' | 'running' | 'verifying' | 'waitingForUser' | 'error'

export interface ChatSummary {
    id: string
    title: string
    createdAt: string
    updatedAt: string
    status: ChatStatus
    model: string | null
    effort: string | null
}

export type ActivityKind = 'command' | 'read' | 'search' | 'tool' | 'web' | 'reasoning' | 'plan'

export type ActivityStatus = 'running' | 'done' | 'failed'

export type FileChangeKind = 'add' | 'delete' | 'update'

export interface FileDiff {
    path: string
    changeKind: FileChangeKind
    diff: string
}

export interface QuestionOption {
    label: string
    description: string
}

export interface Question {
    id: string
    header: string
    question: string
    allowOther: boolean
    options: QuestionOption[]
}

export type VerificationResult = 'passed' | 'failed' | 'restored'

interface EntryBase {
    id: string
    at: string
}

export type ChatEntry =
    | EntryBase & { kind: 'user', text: string }
    | EntryBase & { kind: 'assistant', text: string, streaming: boolean }
    | EntryBase & {
        kind: 'activity'
        activity: ActivityKind
        title: string
        detail: string | null
        status: ActivityStatus
    }
    | EntryBase & { kind: 'fileChange', files: FileDiff[] }
    | EntryBase & {
        kind: 'question'
        requestId: string
        questions: Question[]
        answered: boolean
        answers: Record<string, string[]> | null
    }
    | EntryBase & {
        kind: 'verification'
        result: VerificationResult
        message: string
        versionId: string | null
    }
    | EntryBase & { kind: 'snapshot', versionId: string, label: string }
    | EntryBase & { kind: 'error', message: string }

export interface ChatDetail extends ChatSummary {
    entries: ChatEntry[]
}

export interface CreateChatRequest {
    title?: string
}

export interface RenameChatRequest {
    title: string
}

export interface SendMessageRequest {
    text: string
    model: string | null
    effort: string | null
}

export interface AnswerQuestionRequest {
    requestId: string
    answers: Record<string, string[]>
}

export type VersionKind = 'initial' | 'manual' | 'before-ai' | 'ai-change' | 'restore'

export interface VersionSummary {
    id: string
    shortId: string
    createdAt: string
    kind: VersionKind
    title: string
    chatId: string | null
    userName: string | null
    restoredFrom: string | null
    filesChanged: number
    isCurrent: boolean
}

export interface VersionListResponse {
    versions: VersionSummary[]
    nextCursor: string | null
}

export interface VersionDetail extends VersionSummary {
    files: FileDiff[]
}

export interface RestoreResult {
    version: VersionSummary | null
    checkPassed: boolean
    needsRestart: boolean
    message: string
}

export interface ConfigCheckResult {
    valid: boolean
    errors: string | null
}

export interface ApiError {
    error: string
}

/** Events pushed from the server to the browser over /api/events WebSocket. */
export type ServerEvent =
    | { type: 'chat.updated', chat: ChatSummary }
    | { type: 'chat.deleted', chatId: string }
    | { type: 'chat.entry', chatId: string, entry: ChatEntry }
    | { type: 'chat.delta', chatId: string, entryId: string, delta: string }
    | { type: 'account.updated', account: AccountState }
    | { type: 'history.updated' }
