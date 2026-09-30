import type {
    AccountState,
    UserSettings,
} from '../../shared/api'
import {
    api,
    errorMessage,
} from '../api'
import {
    initialHistory,
    store,
} from '../state'
import { showError } from '../views/toast'
import { loadChats } from './chats'

const LOGIN_EXPIRED_MESSAGE = 'Přihlášení nebylo dokončeno. Kód mohl vypršet – zkuste to prosím znovu.'

let cancelRequested = false

/**
 * Loads the current user and decides between the login screen and the app.
 */
export async function boot(): Promise<void> {
    store.set({ phase: 'loading', fatalError: null })
    try {
        const me = await api.me()
        store.set({ user: me.user, settings: me.settings, addonVersion: me.addonVersion })
        applyAccount(me.account)
    } catch (error) {
        store.set({ phase: 'fatal', fatalError: errorMessage(error) })
    }
}

async function enterApp(): Promise<void> {
    store.set({ phase: 'app', loginError: null, loginBusy: false })
    await Promise.all([loadModels(), loadChats()])
}

/** Fetches available Codex models for the pickers. */
export async function loadModels(): Promise<void> {
    try {
        store.set({ models: await api.models() })
    } catch (error) {
        showError('Nepodařilo se načíst modely', errorMessage(error))
    }
}

/**
 * Applies a new account state coming from REST or WebSocket and switches screens accordingly.
 */
export function applyAccount(account: AccountState): void {
    const state = store.get()
    const previous = state.account
    if (account.status === 'loggedIn') {
        store.set({ account })
        if (state.phase !== 'app') {
            void enterApp()
        }
        return
    }
    const loginFailed = account.status === 'loggedOut' && previous.status === 'pendingLogin' && !cancelRequested
    store.set({
        account,
        phase: 'login',
        loginBusy: false,
        loginError: loginFailed ? LOGIN_EXPIRED_MESSAGE : state.loginError,
        chats: [],
        chatsLoaded: false,
        activeChatId: null,
        activeChat: null,
        history: initialHistory,
    })
    cancelRequested = false
}

/** Re-reads the account state (e.g. after a reconnect while logging in). */
export async function refreshAccount(): Promise<void> {
    try {
        applyAccount((await api.me()).account)
    } catch (error) {
        console.warn('Failed to refresh account', error)
    }
}

/** Starts the ChatGPT device-code login. */
export async function startLogin(): Promise<void> {
    cancelRequested = false
    store.set({ loginBusy: true, loginError: null })
    try {
        applyAccount(await api.startLogin())
    } catch (error) {
        store.set({ loginBusy: false, loginError: errorMessage(error) })
    }
}

/** Cancels a pending device-code login. */
export async function cancelLogin(): Promise<void> {
    cancelRequested = true
    try {
        applyAccount(await api.cancelLogin())
    } catch (error) {
        cancelRequested = false
        store.set({ loginError: errorMessage(error) })
    }
}

/** Logs the current HA user out of ChatGPT. */
export async function logout(): Promise<void> {
    try {
        applyAccount(await api.logout())
        store.set({ loginError: null })
    } catch (error) {
        showError('Odhlášení se nepodařilo', errorMessage(error))
    }
}

/** Persists model / reasoning selection (optimistic update). */
export async function saveSettings(settings: UserSettings): Promise<void> {
    const previous = store.get().settings
    store.set({ settings })
    try {
        store.set({ settings: await api.saveSettings(settings) })
    } catch (error) {
        store.set({ settings: previous })
        showError('Nastavení se nepodařilo uložit', errorMessage(error))
    }
}
