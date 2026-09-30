import type {
    AccountState,
    ChatDetail,
    ChatSummary,
    CurrentUser,
    ModelOption,
    UserSettings,
    VersionDetail,
    VersionSummary,
} from '../shared/api'
import { Store } from './store'

export type Phase = 'loading' | 'login' | 'app' | 'fatal'

export type MainView = 'chats' | 'history'

export type ConnectionState = 'connecting' | 'open' | 'lost'

export interface HistoryState {
    versions: VersionSummary[]
    nextCursor: string | null
    loaded: boolean
    loading: boolean
    error: string | null
    selectedId: string | null
    detail: VersionDetail | null
    detailLoading: boolean
    restoring: boolean
}

export interface AppState {
    phase: Phase
    fatalError: string | null
    user: CurrentUser | null
    addonVersion: string
    account: AccountState
    loginBusy: boolean
    loginError: string | null
    settings: UserSettings
    models: ModelOption[]
    chats: ChatSummary[]
    chatsLoaded: boolean
    activeChatId: string | null
    activeChat: ChatDetail | null
    chatLoading: boolean
    sending: boolean
    view: MainView
    search: string
    drawerOpen: boolean
    connection: ConnectionState
    history: HistoryState
}

/** Empty history slice used on start and after logout. */
export const initialHistory: HistoryState = {
    versions: [],
    nextCursor: null,
    loaded: false,
    loading: false,
    error: null,
    selectedId: null,
    detail: null,
    detailLoading: false,
    restoring: false,
}

/** Global application store. */
export const store = new Store<AppState>({
    phase: 'loading',
    fatalError: null,
    user: null,
    addonVersion: '',
    account: { status: 'loggedOut' },
    loginBusy: false,
    loginError: null,
    settings: { model: null, effort: null },
    models: [],
    chats: [],
    chatsLoaded: false,
    activeChatId: null,
    activeChat: null,
    chatLoading: false,
    sending: false,
    view: 'chats',
    search: '',
    drawerOpen: false,
    connection: 'connecting',
    history: initialHistory,
})

/**
 * Applies a partial update to the history slice.
 */
export function setHistory(patch: Partial<HistoryState>): void {
    store.set((state) => ({ history: { ...state.history, ...patch } }))
}
