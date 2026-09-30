import type {
    ActivityKind,
    ActivityStatus,
    ChatEntry,
} from '../../../shared/api'
import {
    h,
    replaceContent,
} from '../../dom'
import { pluralize } from '../../format'
import {
    icon,
    type IconName,
} from '../../icons'
import {
    entriesOfKind,
    type EntryBlock,
    type EntryOf,
} from './types'

type ActivityEntry = EntryOf<'activity'>

const KIND_ICONS: Record<ActivityKind, IconName> = {
    command: 'terminal',
    read: 'eye',
    search: 'search',
    tool: 'wrench',
    web: 'globe',
    reasoning: 'bulb',
    plan: 'list',
}

const STATUS_LABELS: Record<ActivityStatus, string> = {
    running: 'probíhá',
    done: 'hotovo',
    failed: 'neúspěšné',
}

const PROSE_KINDS: ReadonlySet<ActivityKind> = new Set(['reasoning', 'plan'])

function statusMark(status: ActivityStatus): HTMLElement {
    const mark = h('span', { className: `status-mark is-${status}`, attrs: { title: STATUS_LABELS[status] } })
    if (status === 'running') {
        mark.appendChild(h('span', { className: 'spinner spinner-small', attrs: { 'aria-hidden': 'true' } }))
    } else {
        mark.appendChild(icon(status === 'done' ? 'check' : 'close'))
    }
    mark.appendChild(h('span', 'sr-only', STATUS_LABELS[status]))
    return mark
}

function renderItem(entry: ActivityEntry, wasOpen: boolean): HTMLElement {
    const head: Node[] = [
        h('span', 'activity-icon', icon(KIND_ICONS[entry.activity] ?? 'wrench')),
        h('span', 'activity-title', entry.title),
        statusMark(entry.status),
    ]
    if (!entry.detail) {
        return h('li', `activity-item is-${entry.status}`, h('div', 'activity-row', ...head))
    }
    const detailClass = PROSE_KINDS.has(entry.activity) ? 'activity-detail is-prose' : 'activity-detail'
    const details = h('details', 'activity-details',
        h('summary', 'activity-row', ...head),
        h('pre', detailClass, entry.detail),
    )
    details.open = wasOpen
    return h('li', { className: `activity-item is-${entry.status}`, attrs: { 'data-id': entry.id } }, details)
}

function groupSummary(activities: ActivityEntry[]): { status: ActivityStatus, note: string } {
    const running = activities.find((activity) => activity.status === 'running')
    if (running) {
        return { status: 'running', note: running.title }
    }
    const failed = activities.filter((activity) => activity.status === 'failed').length
    return { status: 'done', note: failed ? pluralize(failed, 'krok neuspěl', 'kroky neuspěly', 'kroků neuspělo') : '' }
}

/**
 * Collapsible "Průběh práce (N kroků)" block grouping consecutive activity entries.
 */
export function activityGroup(entries: ChatEntry[]): EntryBlock {
    const listId = `activities-${entries[0]?.id ?? Date.now()}`
    const list = h('ol', { className: 'activity-list', attrs: { id: listId } })
    list.hidden = true
    const toggle = h('button', {
        className: 'activity-toggle',
        attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': listId },
        on: {
            click: () => {
                list.hidden = !list.hidden
                toggle.setAttribute('aria-expanded', String(!list.hidden))
                element.classList.toggle('is-open', !list.hidden)
            },
        },
    })
    const element = h('section', 'activity-group', toggle, list)
    const rendered = new Map<string, { entry: ActivityEntry, node: HTMLElement }>()

    const update = (next: ChatEntry[]): void => {
        const activities = entriesOfKind(next, 'activity')
        activities.forEach((entry) => {
            const current = rendered.get(entry.id)
            if (current && current.entry === entry) {
                list.appendChild(current.node)
                return
            }
            const wasOpen = current?.node.querySelector('details')?.open ?? false
            const node = renderItem(entry, wasOpen)
            current?.node.replaceWith(node)
            rendered.set(entry.id, { entry, node })
            list.appendChild(node)
        })
        const summary = groupSummary(activities)
        element.classList.toggle('is-running', summary.status === 'running')
        replaceContent(toggle,
            statusMark(summary.status),
            h('span', 'activity-toggle-title', 'Průběh práce ', h('span', 'muted', `(${pluralize(activities.length, 'krok', 'kroky', 'kroků')})`)),
            summary.note ? h('span', 'activity-toggle-note', summary.note) : null,
            icon('chevronDown', 'activity-chevron'),
        )
    }
    update(entries)
    return { element, update }
}
