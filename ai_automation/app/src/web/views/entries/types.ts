import type { ChatEntry } from '../../../shared/api'

export type EntryOf<K extends ChatEntry['kind']> = Extract<ChatEntry, { kind: K }>

/** Callbacks that entry blocks need from the surrounding chat view. */
export interface EntryContext {
    openVersion: (versionId: string) => void
    answer: (requestId: string, answers: Record<string, string[]>) => Promise<boolean>
}

/** A rendered group of one or more consecutive entries that can update itself in place. */
export interface EntryBlock {
    element: HTMLElement
    update: (entries: ChatEntry[]) => void
}

/**
 * Picks the entries of one kind from a block's entry list.
 */
export function entriesOfKind<K extends ChatEntry['kind']>(entries: ChatEntry[], kind: K): EntryOf<K>[] {
    return entries.filter((entry): entry is EntryOf<K> => entry.kind === kind)
}
