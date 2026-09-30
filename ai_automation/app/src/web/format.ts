import type {
    ChatStatus,
    FileChangeKind,
    VersionKind,
} from '../shared/api'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const SHORT_ID_LENGTH = 7

const EFFORT_LABELS: Record<string, string> = {
    none: 'Žádné',
    minimal: 'Minimální',
    low: 'Nízké',
    medium: 'Střední',
    high: 'Vysoké',
    xhigh: 'Maximální',
}

const VERSION_KIND_LABELS: Record<VersionKind, string> = {
    initial: 'Počáteční stav',
    manual: 'Ruční změna',
    'before-ai': 'Před AI',
    'ai-change': 'Změna AI',
    restore: 'Obnovení',
}

const FILE_CHANGE_LABELS: Record<FileChangeKind, string> = {
    add: 'nový',
    update: 'upravený',
    delete: 'smazaný',
}

const STATUS_TEXTS: Partial<Record<ChatStatus, string>> = {
    queued: 'Čeká ve frontě…',
    running: 'Codex pracuje…',
    verifying: 'Ověřuji konfiguraci…',
    waitingForUser: 'Čekám na vaši odpověď',
}

export type DayGroup = 'today' | 'yesterday' | 'older'

/** Czech label for a reasoning effort id (unknown ids are returned unchanged). */
export function effortLabel(effortId: string): string {
    return EFFORT_LABELS[effortId] ?? effortId
}

/** Czech label for a history version kind. */
export function versionKindLabel(kind: VersionKind): string {
    return VERSION_KIND_LABELS[kind]
}

/** Czech badge text for a file change kind. */
export function fileChangeLabel(kind: FileChangeKind): string {
    return FILE_CHANGE_LABELS[kind]
}

/** Status line shown under the composer, or null when the chat is idle. */
export function chatStatusText(status: ChatStatus | null): string | null {
    return status ? STATUS_TEXTS[status] ?? null : null
}

/** True while Codex is actively working on the chat. */
export function isBusyStatus(status: ChatStatus | null | undefined): boolean {
    return status === 'running' || status === 'queued' || status === 'verifying'
}

/** Shortens a git commit id for display. */
export function shortId(versionId: string): string {
    return versionId.slice(0, SHORT_ID_LENGTH)
}

/**
 * Czech plural form: pluralize(2, 'krok', 'kroky', 'kroků') -> '2 kroky'.
 */
export function pluralize(count: number, one: string, few: string, many: string): string {
    const form = count === 1 ? one : count >= 2 && count <= 4 ? few : many
    return `${count} ${form}`
}

function startOfDay(date: Date): number {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function clockTime(date: Date): string {
    return date.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
}

/** Groups a timestamp into Dnes / Včera / Starší buckets. */
export function dayGroup(iso: string, now: Date = new Date()): DayGroup {
    const time = new Date(iso).getTime()
    const today = startOfDay(now)
    if (time >= today) {
        return 'today'
    }
    return time >= today - DAY_MS ? 'yesterday' : 'older'
}

/** Full localized date and time, used for tooltips. */
export function absoluteTime(iso: string): string {
    const date = new Date(iso)
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('cs-CZ')
}

/**
 * Human friendly relative time in Czech ("právě teď", "před 5 min", "včera 14:05", ...).
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
    const date = new Date(iso)
    const time = date.getTime()
    if (Number.isNaN(time)) {
        return ''
    }
    const diff = now.getTime() - time
    if (diff < MINUTE_MS) {
        return 'právě teď'
    }
    if (diff < HOUR_MS) {
        return `před ${Math.floor(diff / MINUTE_MS)} min`
    }
    const group = dayGroup(iso, now)
    if (group === 'today') {
        return clockTime(date)
    }
    if (group === 'yesterday') {
        return `včera ${clockTime(date)}`
    }
    if (diff < 6 * DAY_MS) {
        return `${date.toLocaleDateString('cs-CZ', { weekday: 'short' })} ${clockTime(date)}`
    }
    return date.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })
}
