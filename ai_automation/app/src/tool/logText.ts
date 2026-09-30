/**
 * Pure helpers for log output filtering.
 */
import { normalizeSearchText } from './search.js'

/** Log sources supported by `haos-tool logs`. */
export type LogSource = 'core' | 'supervisor' | 'host'

export const LOG_SOURCES: readonly LogSource[] = ['core', 'supervisor', 'host']

/** Removes ANSI color escape sequences. */
export function stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
}

/** Returns true when the value is a supported log source. */
export function isLogSource(value: string): value is LogSource {
    return (LOG_SOURCES as readonly string[]).includes(value)
}

/** Applies optional grep (case/diacritics insensitive) and keeps the last `lines` lines. */
export function selectLogLines(text: string, lines: number, grep: string | null): string {
    let rows = stripAnsi(text).split('\n')
    if (rows.at(-1) === '') {
        rows.pop()
    }
    if (grep !== null) {
        const needle = normalizeSearchText(grep)
        rows = rows.filter((row) => normalizeSearchText(row).includes(needle))
    }
    return rows.slice(-lines).join('\n')
}
