import type { FileDiff } from '../../shared/api.js'
import type { GitRunner } from './gitRunner.js'
import {
    parseNameStatus,
    splitPatch,
} from './versionParser.js'

/** Maximal size of one file diff returned to the UI. */
export const MAX_FILE_DIFF_BYTES = 200 * 1024

const TRUNCATED_NOTE = '\n… (diff zkrácen, soubor je příliš velký)\n'
const TOO_LARGE_NOTE = '(diff je příliš velký pro zobrazení)'
const DIFF_FLAGS = ['--no-renames', '--no-color', '--no-ext-diff', '--no-textconv']

/**
 * Truncates a diff to MAX_FILE_DIFF_BYTES (UTF-8 bytes).
 *
 * @param diff full diff text
 * @returns possibly truncated diff
 */
export function truncateDiff(diff: string): string {
    const buffer = Buffer.from(diff, 'utf8')
    if (buffer.length <= MAX_FILE_DIFF_BYTES) {
        return diff
    }
    return buffer.subarray(0, MAX_FILE_DIFF_BYTES).toString('utf8') + TRUNCATED_NOTE
}

/**
 * Collects per-file diffs for a `git diff` range.
 *
 * @param git git runner
 * @param rangeArgs diff arguments, e.g. ['--cached', 'HEAD'] or [parentSha, sha]
 * @param includePatch false to return the file list only (diff '')
 * @returns file diffs in path order
 */
export async function collectDiffs(git: GitRunner, rangeArgs: string[], includePatch = true): Promise<FileDiff[]> {
    const nameStatus = await git.run(['diff', ...DIFF_FLAGS, '--name-status', '-z', ...rangeArgs])
    const entries = parseNameStatus(nameStatus.stdout)
    if (!includePatch || entries.length === 0) {
        return entries.map((entry) => ({ ...entry, diff: '' }))
    }
    let chunks: string[]
    try {
        chunks = splitPatch((await git.run(['diff', ...DIFF_FLAGS, '--patch', ...rangeArgs])).stdout)
    } catch {
        return entries.map((entry) => ({ ...entry, diff: TOO_LARGE_NOTE }))
    }
    if (chunks.length === entries.length) {
        return entries.map((entry, index) => ({ ...entry, diff: truncateDiff(chunks[index] ?? '') }))
    }
    return await collectPerFile(git, rangeArgs, entries.map((entry) => ({ ...entry, diff: '' })))
}

async function collectPerFile(git: GitRunner, rangeArgs: string[], files: FileDiff[]): Promise<FileDiff[]> {
    for (const file of files) {
        try {
            const result = await git.run(['diff', ...DIFF_FLAGS, '--patch', ...rangeArgs, '--', `:(literal)${file.path}`])
            file.diff = truncateDiff(result.stdout)
        } catch {
            file.diff = TOO_LARGE_NOTE
        }
    }
    return files
}
