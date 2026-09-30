import type {
    ConfigCheckResult,
    FileDiff,
    ServerEvent,
    VersionKind,
    VersionSummary,
} from '../../shared/api.js'

/**
 * Narrow structural views of collaborating services used by the chat runner.
 * The real classes (CodexSession, CodexSessionPool, EventHub, ConfigHistory, ConfigGuard)
 * satisfy these interfaces; tests can provide lightweight fakes.
 */

/** Handler for JSON-RPC requests sent by the app-server to the client. */
export type ChatServerRequestHandler = (method: string, params: unknown) => Promise<unknown>

/** Listener for app-server notifications. */
export type NotificationListener = (method: string, params: unknown) => void

/** Listener for the app-server process exit. */
export type ExitListener = (code: number | null) => void

/** Subset of CodexSession used by chats. */
export interface ChatSession {
    request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T>
    setServerRequestHandler(handler: ChatServerRequestHandler): void
    on(event: 'notification', listener: NotificationListener): unknown
    on(event: 'exit', listener: ExitListener): unknown
    off(event: 'notification', listener: NotificationListener): unknown
    off(event: 'exit', listener: ExitListener): unknown
}

/** Subset of CodexSessionPool used by chats. */
export interface ChatSessionPool {
    get(userId: string): Promise<ChatSession>
    markBusy(userId: string, busy: boolean): void
}

/** Subset of EventHub used by chats. */
export interface ChatEventPublisher {
    publish(userId: string, event: ServerEvent): void
    broadcast(event: ServerEvent): void
}

/** Snapshot request, structurally identical to history's SnapshotInput. */
export interface ChatSnapshotInput {
    kind: VersionKind
    title: string
    chatId?: string | null
    userName?: string | null
    restoredFrom?: string | null
}

/** Subset of ConfigHistory used by chats. */
export interface ChatHistory {
    snapshot(input: ChatSnapshotInput): Promise<VersionSummary | null>
    currentVersionId(): Promise<string>
    restore(
        versionId: string,
        userName: string,
        options?: { pendingKind?: VersionKind, pendingTitle?: string, title?: string, chatId?: string | null },
    ): Promise<{ version: VersionSummary | null, changedPaths: string[] }>
    diffWorkTree(): Promise<FileDiff[]>
}

/** Subset of ConfigGuard used by chats. */
export interface ChatConfigGuard {
    checkConfig(): Promise<ConfigCheckResult>
    reloadAll(): Promise<void>
}
