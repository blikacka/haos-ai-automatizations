/**
 * Minimal local subset of the Codex app-server protocol (generated bindings of codex-cli 0.154.0
 * live in .claude/codex-protocol-ts). Only the shapes used by this add-on are described here.
 * The wire format is JSON-RPC 2.0 without the "jsonrpc" field, one JSON message per line.
 */

/** JSON-RPC request id. */
export type RequestId = string | number

/** Error object of a JSON-RPC error response. */
export interface JsonRpcErrorObject {
    code: number
    message: string
    data?: unknown
}

/** Request (client -> server or server -> client). */
export interface JsonRpcRequestMessage {
    id: RequestId
    method: string
    params?: unknown
}

/** Notification (no id, no reply). */
export interface JsonRpcNotificationMessage {
    method: string
    params?: unknown
}

/** Successful response. */
export interface JsonRpcResultMessage {
    id: RequestId
    result: unknown
}

/** Error response. */
export interface JsonRpcErrorMessage {
    id: RequestId | null
    error: JsonRpcErrorObject
}

/** Standard JSON-RPC error codes used by the client. */
export const JSON_RPC_ERRORS = {
    methodNotFound: -32601,
    internalError: -32603,
} as const

/** Client identification sent with `initialize`. */
export interface ClientInfo {
    name: string
    title: string | null
    version: string
}

/** Params of `initialize`. */
export interface InitializeParams {
    clientInfo: ClientInfo
    capabilities: null
}

/** Account returned by `account/read`. */
export type CodexAccount =
    | { type: 'apiKey' }
    | { type: 'chatgpt', email: string | null, planType: string }
    | { type: 'amazonBedrock', usesCodexManagedCredentials: boolean }

/** Response of `account/read`. */
export interface GetAccountResponse {
    account: CodexAccount | null
    requiresOpenaiAuth: boolean
}

/** Response of `account/login/start` for the device code flow. */
export interface DeviceCodeLoginResponse {
    type: 'chatgptDeviceCode'
    loginId: string
    verificationUrl: string
    userCode: string
}

/** Notification `account/login/completed`. */
export interface AccountLoginCompletedNotification {
    loginId: string | null
    success: boolean
    error: string | null
}

/** Reasoning effort option of a model. */
export interface ReasoningEffortOption {
    reasoningEffort: string
    description: string
}

/** Model entry of `model/list`. */
export interface CodexModel {
    id: string
    model: string
    displayName: string
    description: string
    hidden: boolean
    supportedReasoningEfforts: ReasoningEffortOption[]
    defaultReasoningEffort: string
    isDefault: boolean
}

/** Response of `model/list`. */
export interface ModelListResponse {
    data: CodexModel[]
    nextCursor: string | null
}

/** Status of command executions and patch applications. */
export type ItemStatus = 'inProgress' | 'completed' | 'failed' | 'declined'

/** Parsed command action (best-effort) attached to a command execution. */
export type CommandAction =
    | { type: 'read', command: string, name: string, path: string }
    | { type: 'listFiles', command: string, path: string | null }
    | { type: 'search', command: string, query: string | null, path: string | null }
    | { type: 'unknown', command: string }

/** Single file change of a `fileChange` item. */
export interface FileUpdateChange {
    path: string
    kind: { type: 'add' } | { type: 'delete' } | { type: 'update', move_path: string | null }
    diff: string
}

/** One question of `item/tool/requestUserInput`. */
export interface UserInputQuestion {
    id: string
    header: string
    question: string
    isOther: boolean
    isSecret: boolean
    options: { label: string, description: string }[] | null
}

/** Method names used by the add-on. */
export const CODEX_METHODS = {
    initialize: 'initialize',
    initialized: 'initialized',
    accountRead: 'account/read',
    loginStart: 'account/login/start',
    loginCancel: 'account/login/cancel',
    logout: 'account/logout',
    loginCompleted: 'account/login/completed',
    accountUpdated: 'account/updated',
    modelList: 'model/list',
} as const

/** Server requests asking for an approval (auto-accepted by the add-on). */
export const APPROVAL_REQUEST_METHODS: ReadonlySet<string> = new Set([
    'item/commandExecution/requestApproval',
    'item/fileChange/requestApproval',
])

/** Legacy (v1) approval requests; their accept decision is 'approved'. */
export const LEGACY_APPROVAL_REQUEST_METHODS: ReadonlySet<string> = new Set([
    'execCommandApproval',
    'applyPatchApproval',
])
