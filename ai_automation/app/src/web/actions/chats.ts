import type {
    ChatDetail,
    ChatEntry,
    ChatSummary,
} from '../../shared/api'
import {
    api,
    errorMessage,
} from '../api'
import { store } from '../state'
import { showError } from '../views/toast'
import {
    selectedEffort,
    selectedModel,
} from '../selectors'

/** Entry upserts received while the chat detail is still loading; replayed after load (idempotent). */
const bufferedEntries = new Map<string, ChatEntry[]>()

function sortChats(chats: ChatSummary[]): ChatSummary[] {
    return [...chats].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

function summaryOf(chat: ChatDetail): ChatSummary {
    return {
        id: chat.id,
        title: chat.title,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        status: chat.status,
        model: chat.model,
        effort: chat.effort,
    }
}

/** Loads the chat list for the sidebar. */
export async function loadChats(): Promise<void> {
    try {
        store.set({ chats: sortChats(await api.listChats()), chatsLoaded: true })
    } catch (error) {
        store.set({ chatsLoaded: true })
        showError('Nepodařilo se načíst chaty', errorMessage(error))
    }
}

/** Inserts or updates a chat summary (list + active chat header). */
export function upsertChatSummary(summary: ChatSummary): void {
    store.set((state) => {
        const others = state.chats.filter((chat) => chat.id !== summary.id)
        const activeChat = state.activeChat?.id === summary.id
            ? { ...state.activeChat, ...summary }
            : state.activeChat
        return { chats: sortChats([...others, summary]), activeChat }
    })
}

/** Removes a chat locally (after delete or a `chat.deleted` event). */
export function removeChat(chatId: string): void {
    store.set((state) => {
        const isActive = state.activeChatId === chatId
        return {
            chats: state.chats.filter((chat) => chat.id !== chatId),
            activeChatId: isActive ? null : state.activeChatId,
            activeChat: isActive ? null : state.activeChat,
        }
    })
}

function replaceEntries(chatId: string, update: (entries: ChatEntry[]) => ChatEntry[]): void {
    store.set((state) => {
        if (!state.activeChat || state.activeChat.id !== chatId) {
            return {}
        }
        return { activeChat: { ...state.activeChat, entries: update(state.activeChat.entries) } }
    })
}

/** Inserts or replaces a chat entry by id in the open chat. */
export function upsertEntry(chatId: string, entry: ChatEntry): void {
    const state = store.get()
    if (state.activeChatId === chatId && state.activeChat?.id !== chatId) {
        bufferedEntries.set(chatId, [...bufferedEntries.get(chatId) ?? [], entry])
        return
    }
    replaceEntries(chatId, (entries) => {
        const index = entries.findIndex((existing) => existing.id === entry.id)
        if (index === -1) {
            return [...entries, entry]
        }
        const copy = [...entries]
        copy[index] = entry
        return copy
    })
}

/** Appends a streamed text delta to an assistant entry, creating it when unknown. */
export function appendDelta(chatId: string, entryId: string, delta: string): void {
    replaceEntries(chatId, (entries) => {
        const index = entries.findIndex((existing) => existing.id === entryId)
        const existing = index === -1 ? null : entries[index]
        if (!existing) {
            const created: ChatEntry = { id: entryId, at: new Date().toISOString(), kind: 'assistant', text: delta, streaming: true }
            return [...entries, created]
        }
        if (existing.kind !== 'assistant') {
            return entries
        }
        const copy = [...entries]
        copy[index] = { ...existing, text: existing.text + delta, streaming: true }
        return copy
    })
}

/** Opens a chat and loads its entries. */
export async function openChat(chatId: string): Promise<void> {
    const keepCurrent = store.get().activeChat?.id === chatId
    bufferedEntries.delete(chatId)
    store.set({
        activeChatId: chatId,
        activeChat: keepCurrent ? store.get().activeChat : null,
        chatLoading: !keepCurrent,
        view: 'chats',
        drawerOpen: false,
    })
    try {
        const chat = await api.getChat(chatId)
        if (store.get().activeChatId === chatId) {
            store.set({ activeChat: chat, chatLoading: false })
            bufferedEntries.get(chatId)?.forEach((entry) => upsertEntry(chatId, entry))
        }
    } catch (error) {
        if (store.get().activeChatId === chatId) {
            store.set({ activeChatId: null, chatLoading: false })
        }
        showError('Chat se nepodařilo otevřít', errorMessage(error))
    }
}

/** Re-fetches the open chat (used after reconnect to catch up on missed events). */
export async function refreshActiveChat(): Promise<void> {
    const chatId = store.get().activeChatId
    if (!chatId) {
        return
    }
    try {
        const chat = await api.getChat(chatId)
        if (store.get().activeChatId === chatId) {
            store.set({ activeChat: chat })
        }
    } catch (error) {
        console.warn('Failed to refresh chat', error)
    }
}

/** Switches to an empty draft; the chat is created on the first message. */
export function newChat(): void {
    store.set({ activeChatId: null, activeChat: null, chatLoading: false, view: 'chats', drawerOpen: false })
}

/** Renames a chat. */
export async function renameChat(chatId: string, title: string): Promise<void> {
    const trimmed = title.trim()
    if (!trimmed) {
        return
    }
    try {
        upsertChatSummary(await api.renameChat(chatId, trimmed))
    } catch (error) {
        showError('Chat se nepodařilo přejmenovat', errorMessage(error))
    }
}

/** Deletes a chat. */
export async function deleteChat(chatId: string): Promise<void> {
    try {
        await api.deleteChat(chatId)
        removeChat(chatId)
    } catch (error) {
        showError('Chat se nepodařilo smazat', errorMessage(error))
    }
}

async function ensureChat(): Promise<string> {
    const current = store.get().activeChatId
    if (current) {
        return current
    }
    const chat = await api.createChat()
    store.set((state) => ({
        chats: sortChats([...state.chats.filter((item) => item.id !== chat.id), summaryOf(chat)]),
        activeChatId: chat.id,
        activeChat: chat,
    }))
    return chat.id
}

/**
 * Sends a user message (creating the chat when in draft mode). Resolves false on failure.
 */
export async function sendMessage(text: string): Promise<boolean> {
    const state = store.get()
    const model = selectedModel(state)
    store.set({ sending: true })
    try {
        const chatId = await ensureChat()
        await api.sendMessage(chatId, { text, model: model?.id ?? null, effort: selectedEffort(state, model) })
        if (store.get().connection !== 'open') {
            await refreshActiveChat()
        }
        return true
    } catch (error) {
        showError('Zprávu se nepodařilo odeslat', errorMessage(error))
        return false
    } finally {
        store.set({ sending: false })
    }
}

/** Stops the running Codex turn. */
export async function interruptChat(): Promise<void> {
    const chatId = store.get().activeChatId
    if (!chatId) {
        return
    }
    try {
        await api.interrupt(chatId)
    } catch (error) {
        showError('Práci se nepodařilo zastavit', errorMessage(error))
    }
}

/** Submits answers to a question card. Resolves false on failure. */
export async function answerQuestion(requestId: string, answers: Record<string, string[]>): Promise<boolean> {
    const chatId = store.get().activeChatId
    if (!chatId) {
        return false
    }
    try {
        await api.answer(chatId, { requestId, answers })
        return true
    } catch (error) {
        showError('Odpověď se nepodařilo odeslat', errorMessage(error))
        return false
    }
}
