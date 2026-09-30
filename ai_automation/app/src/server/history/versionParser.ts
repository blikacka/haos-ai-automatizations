import type {
    FileChangeKind,
    VersionKind,
    VersionSummary,
} from '../../shared/api.js'

const FIELD_SEPARATOR = '\x1f'
const RECORD_SEPARATOR = '\x1e'
const VERSION_KINDS: readonly VersionKind[] = ['initial', 'manual', 'before-ai', 'ai-change', 'restore']
const TRAILER_PATTERN = /^X-(Kind|Chat|User|Restored-From):[ \t]*(.*)$/
const MAX_TITLE_LENGTH = 200
const SHORT_ID_LENGTH = 7
const LAST_CONTROL_CODE = 0x1f
const DELETE_CODE = 0x7f

/** Pretty format for `git log`: record starts with RS, fields separated by US, numstat follows the last US. */
export const LOG_FORMAT = `--format=${'%x1e%H%x1f%cI%x1f%B%x1f'}`

/** Metadata stored in commit message trailers. */
export interface CommitMeta {
    kind: VersionKind
    title: string
    chatId: string | null
    userName: string | null
    restoredFrom: string | null
}

/**
 * Removes control characters and limits length so user text is safe inside a commit message.
 *
 * @param value raw text
 * @param maxLength maximal length
 * @returns single-line text
 */
export function sanitizeLine(value: string, maxLength: number = MAX_TITLE_LENGTH): string {
    const cleaned = Array.from(value, (char) => {
        const code = char.charCodeAt(0)
        return code <= LAST_CONTROL_CODE || code === DELETE_CODE ? ' ' : char
    }).join('')
    return cleaned.replace(/ {2,}/g, ' ').trim().slice(0, maxLength)
}

/**
 * Builds commit message paragraphs: title and trailer block.
 *
 * @param meta commit metadata
 * @returns [title, trailers]
 */
export function buildCommitMessage(meta: CommitMeta): [string, string] {
    const title = sanitizeLine(meta.title) || meta.kind
    const trailers = [`X-Kind: ${meta.kind}`]
    if (meta.chatId) {
        trailers.push(`X-Chat: ${sanitizeLine(meta.chatId, 64)}`)
    }
    if (meta.userName) {
        trailers.push(`X-User: ${sanitizeLine(meta.userName, 100)}`)
    }
    if (meta.restoredFrom) {
        trailers.push(`X-Restored-From: ${sanitizeLine(meta.restoredFrom, 40)}`)
    }
    return [title, trailers.join('\n')]
}

function toKind(value: string | undefined): VersionKind {
    return VERSION_KINDS.find((kind) => kind === value) ?? 'manual'
}

/**
 * Parses the commit message body into metadata.
 *
 * @param body full commit message (%B)
 * @returns metadata with defaults for missing trailers
 */
export function parseCommitMessage(body: string): CommitMeta {
    const lines = body.split('\n')
    const trailers = new Map<string, string>()
    for (const line of lines) {
        const match = TRAILER_PATTERN.exec(line.trim())
        if (match?.[1] !== undefined && match[2] !== undefined) {
            trailers.set(match[1], match[2].trim())
        }
    }
    const restoredFrom = trailers.get('Restored-From') ?? ''
    return {
        kind: toKind(trailers.get('Kind')),
        title: (lines[0] ?? '').trim(),
        chatId: trailers.get('Chat') || null,
        userName: trailers.get('User') || null,
        restoredFrom: /^[0-9a-f]{7,40}$/.test(restoredFrom) ? restoredFrom : null,
    }
}

function countNumstatFiles(numstat: string): number {
    return numstat.split('\n').filter((line) => /^(\d+|-)\t(\d+|-)\t/.test(line)).length
}

/**
 * Parses output of `git log LOG_FORMAT --numstat`.
 *
 * @param output raw stdout
 * @param headSha current HEAD sha (for isCurrent)
 * @returns summaries in log order
 */
export function parseLog(output: string, headSha: string): VersionSummary[] {
    const versions: VersionSummary[] = []
    for (const record of output.split(RECORD_SEPARATOR)) {
        const firstSeparator = record.indexOf(FIELD_SEPARATOR)
        const secondSeparator = record.indexOf(FIELD_SEPARATOR, firstSeparator + 1)
        const lastSeparator = record.lastIndexOf(FIELD_SEPARATOR)
        if (firstSeparator < 0 || secondSeparator < 0 || lastSeparator <= secondSeparator) {
            continue
        }
        const sha = record.slice(0, firstSeparator).trim()
        const meta = parseCommitMessage(record.slice(secondSeparator + 1, lastSeparator))
        versions.push({
            id: sha,
            shortId: sha.slice(0, SHORT_ID_LENGTH),
            createdAt: new Date(record.slice(firstSeparator + 1, secondSeparator)).toISOString(),
            ...meta,
            filesChanged: countNumstatFiles(record.slice(lastSeparator + 1)),
            isCurrent: sha === headSha,
        })
    }
    return versions
}

/** One entry of `--name-status -z` output. */
export interface NameStatusEntry {
    path: string
    changeKind: FileChangeKind
}

/**
 * Parses `git diff --name-status -z --no-renames` output.
 *
 * @param output raw stdout
 * @returns changed paths in diff order
 */
export function parseNameStatus(output: string): NameStatusEntry[] {
    const tokens = output.split('\0')
    const entries: NameStatusEntry[] = []
    for (let index = 0; index + 1 < tokens.length; index += 2) {
        const status = tokens[index] ?? ''
        const path = tokens[index + 1] ?? ''
        if (status === '' || path === '') {
            continue
        }
        const changeKind: FileChangeKind = status.startsWith('A') ? 'add' : status.startsWith('D') ? 'delete' : 'update'
        entries.push({ path, changeKind })
    }
    return entries
}

/**
 * Splits a multi-file patch into per-file chunks (each starting with `diff --git`).
 *
 * @param patch unified patch
 * @returns chunks in patch order
 */
export function splitPatch(patch: string): string[] {
    if (patch.trim() === '') {
        return []
    }
    return patch.split(/^(?=diff --git )/m).filter((chunk) => chunk.startsWith('diff --git '))
}
