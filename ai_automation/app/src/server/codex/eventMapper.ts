import type {
    ActivityKind,
    ActivityStatus,
    ChatEntry,
    FileChangeKind,
    FileDiff,
    Question,
    QuestionOption,
} from '../../shared/api.js'
import {
    PREVIEW_LENGTH,
    asRec,
    describeCommand,
    str,
    toRelativePath,
    truncate,
    unwrapShellCommand,
    type Rec,
} from './commandTitles.js'

export { unwrapShellCommand } from './commandTitles.js'

/** Maximal length of an activity detail. */
export const MAX_DETAIL_LENGTH = 4096
const DETAIL_TAIL_LENGTH = 1000
const ELLIPSIS = '\n…\n'

type ActivityEntry = Extract<ChatEntry, { kind: 'activity' }>

/**
 * Trims a detail to MAX_DETAIL_LENGTH characters keeping its beginning and end.
 *
 * @param text detail text
 * @returns trimmed text
 */
export function trimDetail(text: string): string {
    if (text.length <= MAX_DETAIL_LENGTH) {
        return text
    }
    const headLength = MAX_DETAIL_LENGTH - DETAIL_TAIL_LENGTH - ELLIPSIS.length
    return `${text.slice(0, headLength)}${ELLIPSIS}${text.slice(text.length - DETAIL_TAIL_LENGTH)}`
}

function mapStatus(status: string | null, exitCode: unknown = null): ActivityStatus {
    if (status === 'failed' || status === 'declined') {
        return 'failed'
    }
    if (typeof exitCode === 'number' && exitCode !== 0) {
        return 'failed'
    }
    return status === 'inProgress' ? 'running' : 'done'
}

function activity(id: string, at: string, kind: ActivityKind, title: string, detail: string | null, status: ActivityStatus): ActivityEntry {
    return { id, at, kind: 'activity', activity: kind, title, detail: detail === null ? null : trimDetail(detail), status }
}

function mapCommand(record: Rec, id: string, at: string, haConfigDir: string): ActivityEntry {
    const rawCommand = str(record, 'command') ?? ''
    const command = unwrapShellCommand(rawCommand)
    const actions = Array.isArray(record.commandActions)
        ? record.commandActions.map(asRec).filter((action): action is Rec => action !== null)
        : []
    const { kind, title } = describeCommand(command, actions, haConfigDir)
    const output = str(record, 'aggregatedOutput')
    const exitCode = record.exitCode
    const lines = [`$ ${command}`]
    if (output !== null && output.trim() !== '') {
        lines.push(output.trimEnd())
    }
    if (typeof exitCode === 'number' && exitCode !== 0) {
        lines.push(`(kód ukončení ${exitCode})`)
    }
    return activity(id, at, kind, title, lines.join('\n'), mapStatus(str(record, 'status'), exitCode))
}

function mapChangeKind(kind: unknown): FileChangeKind {
    const type = str(asRec(kind), 'type') ?? (typeof kind === 'string' ? kind : null)
    return type === 'add' || type === 'delete' ? type : 'update'
}

function mapFileChange(record: Rec, id: string, at: string, haConfigDir: string): ChatEntry | null {
    const changes = Array.isArray(record.changes) ? record.changes.map(asRec) : []
    const files: FileDiff[] = []
    for (const change of changes) {
        const path = str(change, 'path')
        if (path !== null && path !== '') {
            files.push({ path: toRelativePath(path, haConfigDir), changeKind: mapChangeKind(change?.kind), diff: str(change, 'diff') ?? '' })
        }
    }
    if (files.length === 0) {
        return null
    }
    const status = str(record, 'status')
    if (status === 'failed' || status === 'declined') {
        const paths = files.map((file) => file.path).join('\n')
        return activity(id, at, 'command', 'Úprava souborů se nezdařila', paths, 'failed')
    }
    return { id, at, kind: 'fileChange', files }
}

function jsonPreview(value: unknown): string | null {
    if (value === undefined || value === null) {
        return null
    }
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return null
    }
}

function mapToolCall(record: Rec, id: string, at: string, type: string): ActivityEntry {
    const tool = str(record, 'tool') ?? 'nástroj'
    const server = type === 'mcpToolCall' ? str(record, 'server') : str(record, 'namespace')
    const name = server === null ? tool : `${server}/${tool}`
    const errorMessage = str(asRec(record.error), 'message')
    const failed = record.success === false || errorMessage !== null
    const status = failed ? 'failed' : mapStatus(str(record, 'status'))
    return activity(id, at, 'tool', `Používám nástroj ${truncate(name, PREVIEW_LENGTH)}`, errorMessage ?? jsonPreview(record.arguments), status)
}

function joinTexts(value: unknown): string {
    return Array.isArray(value) ? value.filter((part): part is string => typeof part === 'string').join('\n\n') : ''
}

/**
 * Maps a Codex ThreadItem (from item/started or item/completed) to a chat entry.
 * The entry id equals the item id so repeated calls upsert the same entry.
 *
 * @param item raw thread item
 * @param haConfigDir HA config dir (file paths are made relative to it)
 * @param at ISO timestamp of the entry
 * @returns chat entry, or null for ignored / unknown items
 */
export function mapItemToEntry(item: unknown, haConfigDir: string, at: string): ChatEntry | null {
    const record = asRec(item)
    const type = str(record, 'type')
    const id = str(record, 'id')
    if (record === null || type === null || id === null || id === '') {
        return null
    }
    switch (type) {
        case 'agentMessage':
            return { id, at, kind: 'assistant', text: str(record, 'text') ?? '', streaming: false }
        case 'reasoning': {
            const summary = joinTexts(record.summary)
            return activity(id, at, 'reasoning', 'Přemýšlím', summary === '' ? null : summary, 'done')
        }
        case 'plan':
            return activity(id, at, 'plan', 'Plán postupu', str(record, 'text'), 'done')
        case 'webSearch': {
            const query = str(record, 'query')
            const title = query === null || query === '' ? 'Hledám na webu' : `Hledám na webu „${truncate(query, PREVIEW_LENGTH)}“`
            return activity(id, at, 'web', title, null, 'done')
        }
        case 'commandExecution':
            return mapCommand(record, id, at, haConfigDir)
        case 'fileChange':
            return mapFileChange(record, id, at, haConfigDir)
        case 'mcpToolCall':
        case 'dynamicToolCall':
            return mapToolCall(record, id, at, type)
        default:
            return null
    }
}

function mapOptions(value: unknown): QuestionOption[] {
    if (!Array.isArray(value)) {
        return []
    }
    return value.map(asRec)
        .filter((option): option is Rec => str(option, 'label') !== null)
        .map((option) => ({ label: str(option, 'label') ?? '', description: str(option, 'description') ?? '' }))
}

/**
 * Maps `item/tool/requestUserInput` params to UI questions.
 *
 * @param params raw request params
 * @returns questions, or null when the params contain no valid question
 */
export function mapRequestUserInput(params: unknown): Question[] | null {
    const rawQuestions = asRec(params)?.questions
    if (!Array.isArray(rawQuestions)) {
        return null
    }
    const questions: Question[] = []
    for (const raw of rawQuestions.map(asRec)) {
        const id = str(raw, 'id')
        const question = str(raw, 'question')
        if (id === null || id === '' || question === null) {
            continue
        }
        const options = mapOptions(raw?.options)
        questions.push({
            id,
            header: str(raw, 'header') ?? '',
            question,
            allowOther: raw?.isOther === true || options.length === 0,
            options,
        })
    }
    return questions.length === 0 ? null : questions
}

/**
 * Builds the reply to `item/tool/requestUserInput`.
 *
 * @param answers answers per question id
 * @returns response `{answers: {[questionId]: {answers}}}`
 */
export function buildUserInputResponse(answers: Record<string, string[]>): { answers: Record<string, { answers: string[] }> } {
    const result: Record<string, { answers: string[] }> = {}
    for (const [questionId, values] of Object.entries(answers)) {
        if (questionId === '__proto__') {
            continue
        }
        result[questionId] = { answers: Array.isArray(values) ? values.filter((value) => typeof value === 'string') : [] }
    }
    return { answers: result }
}
