import type { ServerEvent } from '../../shared/api'
import type { StreamStatus } from '../events'
import { store } from '../state'
import {
    appendDelta,
    loadChats,
    refreshActiveChat,
    removeChat,
    upsertChatSummary,
    upsertEntry,
} from './chats'
import { loadHistory } from './history'
import {
    applyAccount,
    boot,
    refreshAccount,
} from './session'

/**
 * Routes a WebSocket event to the matching state update.
 */
export function handleServerEvent(event: ServerEvent): void {
    switch (event.type) {
        case 'chat.updated':
            upsertChatSummary(event.chat)
            break
        case 'chat.deleted':
            removeChat(event.chatId)
            break
        case 'chat.entry':
            upsertEntry(event.chatId, event.entry)
            break
        case 'chat.delta':
            appendDelta(event.chatId, event.entryId, event.delta)
            break
        case 'account.updated':
            applyAccount(event.account)
            break
        case 'history.updated':
            if (store.get().history.loaded) {
                void loadHistory()
            }
            break
        default:
            break
    }
}

/**
 * Tracks connection state; after a reconnect it re-syncs everything that might have been missed.
 */
export function handleStreamStatus(status: StreamStatus, reconnected: boolean): void {
    store.set({ connection: status })
    if (!reconnected) {
        return
    }
    const state = store.get()
    if (state.phase === 'fatal') {
        void boot()
        return
    }
    if (state.phase !== 'app') {
        void refreshAccount()
        return
    }
    void loadChats()
    void refreshActiveChat()
    if (state.history.loaded) {
        void loadHistory()
    }
}
