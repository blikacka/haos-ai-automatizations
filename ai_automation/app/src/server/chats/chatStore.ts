import {
    readdir,
    rm,
} from 'node:fs/promises'
import { join } from 'node:path'
import type {
    ChatDetail,
    ChatSummary,
} from '../../shared/api.js'
import {
    isSafeId,
    newId,
    userDirName,
} from '../util/ids.js'
import {
    readJsonFile,
    writeJsonFileAtomic,
} from '../util/jsonFile.js'
import { logger } from '../util/logger.js'

/** Chat as persisted on disk – the public detail plus the Codex thread binding. */
export interface StoredChat extends ChatDetail {
    threadId: string | null
}

/** Title used for chats that were not named yet. */
export const DEFAULT_CHAT_TITLE = 'Nový chat'

/** Maximal chat title length. */
export const MAX_TITLE_LENGTH = 200
const CHAT_FILE_SUFFIX = '.json'

/**
 * Converts a stored chat to its list summary.
 *
 * @param chat stored chat
 * @returns summary without entries and thread binding
 */
export function toSummary(chat: StoredChat): ChatSummary {
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

function isStoredChat(value: unknown): value is StoredChat {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const candidate = value as Partial<StoredChat>
    return typeof candidate.id === 'string'
        && typeof candidate.title === 'string'
        && typeof candidate.createdAt === 'string'
        && typeof candidate.updatedAt === 'string'
        && typeof candidate.status === 'string'
        && Array.isArray(candidate.entries)
}

function normalizeTitle(title: string | undefined): string {
    const trimmed = (title ?? '').trim().slice(0, MAX_TITLE_LENGTH)
    return trimmed === '' ? DEFAULT_CHAT_TITLE : trimmed
}

/** File based chat persistence, one directory per HA user. */
export class ChatStore {
    private readonly usersDir: string

    /**
     * @param dataDir persistent add-on data directory
     */
    public constructor(dataDir: string) {
        this.usersDir = join(dataDir, 'users')
    }

    /**
     * Lists all chats of a user; corrupted files are skipped and logged.
     *
     * @param userId HA user id
     * @returns summaries, newest updatedAt first
     */
    public async list(userId: string): Promise<ChatSummary[]> {
        const dir = this.chatsDir(userId)
        let fileNames: string[]
        try {
            fileNames = await readdir(dir)
        } catch {
            return []
        }
        const chatIds = fileNames
            .filter((name) => name.endsWith(CHAT_FILE_SUFFIX))
            .map((name) => name.slice(0, -CHAT_FILE_SUFFIX.length))
            .filter((chatId) => isSafeId(chatId))
        const chats = await Promise.all(chatIds.map((chatId) => this.readChat(userId, chatId)))
        const summaries: ChatSummary[] = []
        chats.forEach((chat, index) => {
            if (chat === null) {
                logger.warn('Skipping unreadable chat file', { chatId: chatIds[index] })
                return
            }
            summaries.push(toSummary(chat))
        })
        return summaries
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    }

    /**
     * Creates and persists a new empty chat.
     *
     * @param userId HA user id
     * @param title optional title, defaults to 'Nový chat'
     * @returns created chat
     */
    public async create(userId: string, title?: string): Promise<StoredChat> {
        const now = new Date().toISOString()
        const chat: StoredChat = {
            id: newId(),
            title: normalizeTitle(title),
            createdAt: now,
            updatedAt: now,
            status: 'idle',
            model: null,
            effort: null,
            entries: [],
            threadId: null,
        }
        await this.save(userId, chat)
        return chat
    }

    /**
     * Loads a chat.
     *
     * @param userId HA user id
     * @param chatId chat id (validated)
     * @returns chat or null when missing, invalid id or corrupted
     */
    public async get(userId: string, chatId: string): Promise<StoredChat | null> {
        if (!isSafeId(chatId)) {
            return null
        }
        return this.readChat(userId, chatId)
    }

    /**
     * Persists a chat atomically.
     *
     * @param userId HA user id
     * @param chat chat to store
     * @throws Error when the chat id is unsafe or writing fails
     */
    public async save(userId: string, chat: StoredChat): Promise<void> {
        await writeJsonFileAtomic(this.chatPath(userId, chat.id), chat)
    }

    /**
     * Deletes a chat.
     *
     * @param userId HA user id
     * @param chatId chat id
     * @returns true when a chat was deleted
     */
    public async delete(userId: string, chatId: string): Promise<boolean> {
        if (!isSafeId(chatId) || await this.readChat(userId, chatId) === null) {
            return false
        }
        await rm(this.chatPath(userId, chatId), { force: true })
        return true
    }

    private async readChat(userId: string, chatId: string): Promise<StoredChat | null> {
        const path = this.chatPath(userId, chatId)
        const data = await readJsonFile<unknown>(path, null)
        if (data === null) {
            return null
        }
        if (!isStoredChat(data) || data.id !== chatId) {
            logger.warn('Skipping corrupted chat file', { path })
            return null
        }
        return { ...data, threadId: data.threadId ?? null }
    }

    private chatsDir(userId: string): string {
        return join(this.usersDir, userDirName(userId), 'chats')
    }

    private chatPath(userId: string, chatId: string): string {
        if (!isSafeId(chatId)) {
            throw new Error('Invalid chat id')
        }
        return join(this.chatsDir(userId), `${chatId}${CHAT_FILE_SUFFIX}`)
    }
}
