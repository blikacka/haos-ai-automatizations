import type {
    ChatEntry,
    ChatStatus,
} from '../../shared/api.js'
import { logger } from '../util/logger.js'
import {
    findEntry,
    nowIso,
    streamingAssistantEntry,
    upsertEntry,
} from './chatEntries.js'
import {
    toSummary,
    type ChatStore,
    type StoredChat,
} from './chatStore.js'
import type { ChatEventPublisher } from './ports.js'
import { errorMessage } from './unknownValue.js'

const SAVE_INTERVAL_MS = 1000

/**
 * In-memory chat being worked on by the runner: applies changes, publishes hub events and
 * persists with throttling (at most one write per second plus an explicit final flush).
 * Title renames and deletions done through the store meanwhile are respected.
 */
export class LiveChat {
    private lastSaveAt = 0
    private saveTimer: NodeJS.Timeout | null = null
    private saving: Promise<void> = Promise.resolve()
    private lastSavedTitle: string
    private deleted = false

    /**
     * @param store chat persistence
     * @param hub event publisher
     * @param userId owner HA user id
     * @param chat chat state (mutated in place)
     */
    public constructor(
        private readonly store: ChatStore,
        private readonly hub: ChatEventPublisher,
        public readonly userId: string,
        public readonly chat: StoredChat,
    ) {
        this.lastSavedTitle = chat.title
    }

    /** Whether the chat was deleted by the user while being worked on. */
    public get isDeleted(): boolean {
        return this.deleted
    }

    /**
     * Inserts or replaces an entry and publishes it.
     *
     * @param entry entry to upsert
     */
    public putEntry(entry: ChatEntry): void {
        upsertEntry(this.chat.entries, entry)
        this.touch()
        this.hub.publish(this.userId, { type: 'chat.entry', chatId: this.chat.id, entry })
        this.scheduleSave()
    }

    /**
     * Appends streamed assistant text; creates the streaming entry when missing.
     *
     * @param entryId assistant item id
     * @param delta text chunk
     */
    public appendDelta(entryId: string, delta: string): void {
        let entry = findEntry(this.chat.entries, entryId)
        if (entry === undefined) {
            entry = streamingAssistantEntry(entryId)
            this.putEntry(entry)
        }
        if (entry.kind !== 'assistant') {
            return
        }
        entry.text += delta
        this.hub.publish(this.userId, { type: 'chat.delta', chatId: this.chat.id, entryId, delta })
    }

    /**
     * Changes the chat status and publishes the summary.
     *
     * @param status new status
     */
    public setStatus(status: ChatStatus): void {
        this.chat.status = status
        this.touch()
        this.publishSummary()
        this.scheduleSave()
    }

    /**
     * Renames the chat and persists it immediately.
     *
     * @param title new (already validated) title
     */
    public async rename(title: string): Promise<void> {
        this.chat.title = title
        this.touch()
        this.publishSummary()
        await this.flush()
    }

    /** Publishes the current chat summary. */
    public publishSummary(): void {
        this.hub.publish(this.userId, { type: 'chat.updated', chat: toSummary(this.chat) })
    }

    /** Schedules a throttled save. */
    public scheduleSave(): void {
        if (this.saveTimer !== null) {
            return
        }
        const waitMs = Math.max(0, this.lastSaveAt + SAVE_INTERVAL_MS - Date.now())
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null
            void this.enqueueSave()
        }, waitMs)
    }

    /**
     * Cancels any pending throttled save and writes immediately.
     *
     * @returns resolves when the write finished (errors are logged)
     */
    public async flush(): Promise<void> {
        if (this.saveTimer !== null) {
            clearTimeout(this.saveTimer)
            this.saveTimer = null
        }
        await this.enqueueSave()
    }

    private touch(): void {
        this.chat.updatedAt = nowIso()
    }

    private enqueueSave(): Promise<void> {
        this.saving = this.saving.then(() => this.writeNow())
        return this.saving
    }

    private async writeNow(): Promise<void> {
        this.lastSaveAt = Date.now()
        if (this.deleted) {
            return
        }
        try {
            const onDisk = await this.store.get(this.userId, this.chat.id)
            if (onDisk === null) {
                this.deleted = true
                logger.info('Chat was deleted during a turn, not saving', { chatId: this.chat.id })
                return
            }
            if (onDisk.title !== this.lastSavedTitle) {
                this.chat.title = onDisk.title
            }
            await this.store.save(this.userId, this.chat)
            this.lastSavedTitle = this.chat.title
        } catch (error) {
            logger.error('Failed to save chat', { chatId: this.chat.id, error: errorMessage(error) })
        }
    }
}
