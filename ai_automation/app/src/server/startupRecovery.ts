import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChatStatus } from '../shared/api.js'
import { errorEntry } from './chats/chatEntries.js'
import type { StoredChat } from './chats/chatStore.js'
import { isSafeId } from './util/ids.js'
import {
    readJsonFile,
    writeJsonFileAtomic,
} from './util/jsonFile.js'
import { logger } from './util/logger.js'

/** Message recorded in chats whose turn was interrupted by an add-on restart. */
export const INTERRUPTED_MESSAGE = 'Přerušeno restartem doplňku'

const INTERRUPTED_STATUSES: ReadonlySet<ChatStatus> = new Set<ChatStatus>(['running', 'queued', 'verifying'])
const USER_DIR_PATTERN = /^[0-9a-f]{32}$/
const CHAT_FILE_SUFFIX = '.json'

async function listDir(dir: string): Promise<string[]> {
    try {
        return await readdir(dir)
    } catch {
        return []
    }
}

function isRecoverable(value: unknown): value is StoredChat {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const candidate = value as Partial<StoredChat>
    return typeof candidate.status === 'string' && Array.isArray(candidate.entries)
}

async function recoverChatFile(filePath: string): Promise<boolean> {
    const chat = await readJsonFile<unknown>(filePath, null)
    if (!isRecoverable(chat) || !INTERRUPTED_STATUSES.has(chat.status)) {
        return false
    }
    const entries = chat.entries.map((entry) => (
        entry.kind === 'assistant' && entry.streaming ? { ...entry, streaming: false } : entry
    ))
    const recovered: StoredChat = {
        ...chat,
        status: 'error',
        updatedAt: new Date().toISOString(),
        entries: [...entries, errorEntry(INTERRUPTED_MESSAGE)],
    }
    await writeJsonFileAtomic(filePath, recovered)
    return true
}

/**
 * Mark chats left in running / queued / verifying state by a previous process as 'error'
 * with an explanatory error entry. Reads `<dataDir>/users/<userDir>/chats/*.json` directly.
 *
 * @returns number of recovered chats
 */
export async function recoverInterruptedChats(dataDir: string): Promise<number> {
    const usersDir = join(dataDir, 'users')
    let recovered = 0
    for (const userDir of await listDir(usersDir)) {
        if (!USER_DIR_PATTERN.test(userDir)) {
            continue
        }
        const chatsDir = join(usersDir, userDir, 'chats')
        for (const fileName of await listDir(chatsDir)) {
            const chatId = fileName.slice(0, -CHAT_FILE_SUFFIX.length)
            if (!fileName.endsWith(CHAT_FILE_SUFFIX) || !isSafeId(chatId)) {
                continue
            }
            try {
                if (await recoverChatFile(join(chatsDir, fileName))) {
                    recovered += 1
                }
            } catch (error) {
                logger.error('Chat recovery failed', {
                    file: fileName,
                    error: error instanceof Error ? error.message : String(error),
                })
            }
        }
    }
    if (recovered > 0) {
        logger.info('Recovered chats interrupted by restart', { count: recovered })
    }
    return recovered
}
