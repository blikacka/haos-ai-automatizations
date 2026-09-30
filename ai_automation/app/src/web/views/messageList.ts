import type { ChatEntry } from '../../shared/api'
import { h } from '../dom'
import { activityGroup } from './entries/activityGroup'
import { fileChangeCard } from './entries/fileChangeCard'
import {
    assistantBlock,
    errorBlock,
    snapshotBlock,
    userBlock,
} from './entries/messageBlocks'
import { questionCard } from './entries/questionCard'
import type {
    EntryBlock,
    EntryContext,
} from './entries/types'
import { verificationCard } from './entries/verificationCard'

interface EntryGroup {
    key: string
    entries: ChatEntry[]
}

interface MountedBlock {
    block: EntryBlock
    entries: ChatEntry[]
}

export interface MessageList {
    element: HTMLElement
    render: (entries: ChatEntry[]) => void
    reset: () => void
}

function isVisible(entry: ChatEntry): boolean {
    return entry.kind !== 'assistant' || entry.streaming || entry.text.trim().length > 0
}

/**
 * Groups entries into render blocks: consecutive activities share one collapsible block.
 */
function groupEntries(entries: ChatEntry[]): EntryGroup[] {
    const groups: EntryGroup[] = []
    let activityRun: EntryGroup | null = null
    for (const entry of entries.filter(isVisible)) {
        if (entry.kind === 'activity') {
            if (!activityRun) {
                activityRun = { key: `activity:${entry.id}`, entries: [] }
                groups.push(activityRun)
            }
            activityRun.entries.push(entry)
            continue
        }
        activityRun = null
        groups.push({ key: `${entry.kind}:${entry.id}`, entries: [entry] })
    }
    return groups
}

function createBlock(group: EntryGroup, context: EntryContext): EntryBlock {
    const first = group.entries[0]
    switch (first?.kind) {
        case 'user':
            return userBlock(group.entries)
        case 'assistant':
            return assistantBlock(group.entries)
        case 'activity':
            return activityGroup(group.entries)
        case 'fileChange':
            return fileChangeCard(group.entries)
        case 'verification':
            return verificationCard(group.entries, context)
        case 'question':
            return questionCard(group.entries, context)
        case 'snapshot':
            return snapshotBlock(group.entries, context)
        default:
            return errorBlock(group.entries)
    }
}

function sameEntries(left: ChatEntry[], right: ChatEntry[]): boolean {
    return left.length === right.length && left.every((entry, index) => entry === right[index])
}

/**
 * Incrementally rendered list of chat entries. Blocks are keyed by entry id and only
 * updated when their entry objects change, so streaming does not re-render the whole chat.
 */
export function createMessageList(context: EntryContext): MessageList {
    const element = h('div', 'message-list')
    const mounted = new Map<string, MountedBlock>()

    const render = (entries: ChatEntry[]): void => {
        const groups = groupEntries(entries)
        const keys = new Set(groups.map((group) => group.key))
        mounted.forEach((item, key) => {
            if (!keys.has(key)) {
                item.block.element.remove()
                mounted.delete(key)
            }
        })
        let cursor: ChildNode | null = element.firstChild
        for (const group of groups) {
            let item = mounted.get(group.key)
            if (!item) {
                item = { block: createBlock(group, context), entries: group.entries }
                mounted.set(group.key, item)
            } else if (!sameEntries(item.entries, group.entries)) {
                item.block.update(group.entries)
                item.entries = group.entries
            }
            if (cursor === item.block.element) {
                cursor = cursor.nextSibling
            } else {
                element.insertBefore(item.block.element, cursor)
            }
        }
    }

    const reset = (): void => {
        mounted.clear()
        element.replaceChildren()
    }

    return { element, render, reset }
}
