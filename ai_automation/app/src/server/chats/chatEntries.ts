import type {
    ActivityKind,
    ChatEntry,
    VerificationResult,
} from '../../shared/api.js'
import { newId } from '../util/ids.js'

/** Assistant entry variant. */
export type AssistantEntry = Extract<ChatEntry, { kind: 'assistant' }>

/** Question entry variant. */
export type QuestionEntry = Extract<ChatEntry, { kind: 'question' }>

/**
 * Current time as ISO string.
 *
 * @returns ISO timestamp
 */
export function nowIso(): string {
    return new Date().toISOString()
}

/**
 * Inserts an entry or replaces the one with the same id (keeping its position).
 *
 * @param entries entry list (mutated)
 * @param entry entry to upsert
 */
export function upsertEntry(entries: ChatEntry[], entry: ChatEntry): void {
    const index = entries.findIndex((existing) => existing.id === entry.id)
    if (index === -1) {
        entries.push(entry)
        return
    }
    entries[index] = entry
}

/**
 * Finds an entry by id.
 *
 * @param entries entry list
 * @param entryId entry id
 * @returns entry or undefined
 */
export function findEntry(entries: ChatEntry[], entryId: string): ChatEntry | undefined {
    return entries.find((entry) => entry.id === entryId)
}

/**
 * Creates a user message entry.
 *
 * @param text message text
 * @returns entry
 */
export function userEntry(text: string): ChatEntry {
    return { id: newId(), at: nowIso(), kind: 'user', text }
}

/**
 * Creates an empty streaming assistant entry.
 *
 * @param entryId item id from Codex
 * @returns entry
 */
export function streamingAssistantEntry(entryId: string): AssistantEntry {
    return { id: entryId, at: nowIso(), kind: 'assistant', text: '', streaming: true }
}

/**
 * Creates an error entry.
 *
 * @param message human readable message
 * @returns entry
 */
export function errorEntry(message: string): ChatEntry {
    return { id: newId(), at: nowIso(), kind: 'error', message }
}

/**
 * Creates a finished activity entry.
 *
 * @param activity activity kind
 * @param title short title
 * @param detail optional detail text
 * @returns entry
 */
export function activityEntry(activity: ActivityKind, title: string, detail: string | null): ChatEntry {
    return { id: newId(), at: nowIso(), kind: 'activity', activity, title, detail, status: 'done' }
}

/**
 * Creates a verification result entry.
 *
 * @param result verification result
 * @param message human readable message
 * @param versionId related config version
 * @returns entry
 */
export function verificationEntry(result: VerificationResult, message: string, versionId: string | null): ChatEntry {
    return { id: newId(), at: nowIso(), kind: 'verification', result, message, versionId }
}

/**
 * Creates a snapshot entry pointing to a config version.
 *
 * @param versionId version sha
 * @param label label shown in the chat
 * @returns entry
 */
export function snapshotEntry(versionId: string, label: string): ChatEntry {
    return { id: newId(), at: nowIso(), kind: 'snapshot', versionId, label }
}

/**
 * Whether the chat contains a question that has not been answered yet.
 *
 * @param entries entry list
 * @returns true when some question is open
 */
export function hasOpenQuestion(entries: ChatEntry[]): boolean {
    return entries.some((entry) => entry.kind === 'question' && !entry.answered)
}

/**
 * Marks every still streaming assistant entry as finished.
 *
 * @param entries entry list (mutated)
 * @returns entries that were changed
 */
export function finishStreaming(entries: ChatEntry[]): ChatEntry[] {
    const changed: ChatEntry[] = []
    for (const entry of entries) {
        if (entry.kind === 'assistant' && entry.streaming) {
            entry.streaming = false
            changed.push(entry)
        }
    }
    return changed
}
