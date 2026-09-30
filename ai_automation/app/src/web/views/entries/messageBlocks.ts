import type { ChatEntry } from '../../../shared/api'
import {
    button,
    h,
    replaceContent,
} from '../../dom'
import { shortId } from '../../format'
import { icon } from '../../icons'
import { renderMarkdown } from '../../markdown'
import { robotMascot } from '../../robot'
import {
    entriesOfKind,
    type EntryBlock,
    type EntryContext,
} from './types'

/** Right aligned bubble with the user's own text. */
export function userBlock(entries: ChatEntry[]): EntryBlock {
    const bubble = h('div', 'bubble bubble-user')
    const element = h('div', 'msg msg-user', bubble)
    const update = (next: ChatEntry[]): void => {
        replaceContent(bubble, entriesOfKind(next, 'user')[0]?.text ?? '')
    }
    update(entries)
    return { element, update }
}

function typingDots(): HTMLElement {
    return h('span', { className: 'typing', attrs: { 'aria-label': 'Codex píše' } }, h('span'), h('span'), h('span'))
}

/** Assistant message with robot avatar, markdown body and streaming caret. */
export function assistantBlock(entries: ChatEntry[]): EntryBlock {
    const bubble = h('div', 'bubble bubble-assistant markdown')
    const element = h('div', 'msg msg-assistant', h('div', 'avatar', robotMascot('robot robot-avatar')), bubble)
    const update = (next: ChatEntry[]): void => {
        const entry = entriesOfKind(next, 'assistant')[0]
        if (!entry) {
            return
        }
        element.classList.toggle('is-streaming', entry.streaming)
        if (!entry.text.trim()) {
            replaceContent(bubble, entry.streaming ? typingDots() : '')
            return
        }
        replaceContent(bubble, renderMarkdown(entry.text))
        if (entry.streaming) {
            const caret = h('span', { className: 'caret', attrs: { 'aria-hidden': 'true' } })
            const last = bubble.lastElementChild
            const target = last && (last.tagName === 'P' || last.tagName === 'LI' || /^H\d$/.test(last.tagName)) ? last : bubble
            target.appendChild(caret)
        }
    }
    update(entries)
    return { element, update }
}

/** Compact chip announcing a saved configuration version. */
export function snapshotBlock(entries: ChatEntry[], context: EntryContext): EntryBlock {
    const element = h('div', 'snapshot-chip')
    const update = (next: ChatEntry[]): void => {
        const entry = entriesOfKind(next, 'snapshot')[0]
        if (!entry) {
            return
        }
        replaceContent(element,
            icon('history'),
            h('span', null, `Uložena verze ${shortId(entry.versionId)}`, entry.label ? `: ${entry.label}` : ''),
            button('link-btn', () => context.openVersion(entry.versionId), ['Zobrazit']),
        )
    }
    update(entries)
    return { element, update }
}

/** Red inline error card. */
export function errorBlock(entries: ChatEntry[]): EntryBlock {
    const element = h('div', { className: 'card card-error', attrs: { role: 'alert' } })
    const update = (next: ChatEntry[]): void => {
        const entry = entriesOfKind(next, 'error')[0]
        replaceContent(element,
            h('span', 'card-icon', icon('alert')),
            h('div', 'card-body', h('strong', null, 'Něco se nepovedlo'), h('p', 'card-text', entry?.message ?? '')),
        )
    }
    update(entries)
    return { element, update }
}
