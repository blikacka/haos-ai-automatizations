import {
    mkdir,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import type {
    FileDiff,
    VersionDetail,
    VersionKind,
    VersionListResponse,
    VersionSummary,
} from '../../shared/api.js'
import { Mutex } from '../util/mutex.js'
import { collectDiffs } from './diffCollector.js'
import { GitRunner } from './gitRunner.js'
import { untrackExcludedFiles } from './untrackExcluded.js'
import {
    LOG_FORMAT,
    buildCommitMessage,
    parseLog,
} from './versionParser.js'

/** Input of a history snapshot. */
export interface SnapshotInput {
    kind: VersionKind
    title: string
    chatId?: string | null
    userName?: string | null
    restoredFrom?: string | null
}

/** Error with an HTTP-like status (400 invalid id, 404 unknown version). */
export class HistoryError extends Error {
    public readonly status: number

    /**
     * @param message user facing message
     * @param status 400 or 404
     */
    public constructor(message: string, status: number) {
        super(message)
        this.name = 'HistoryError'
        this.status = status
    }
}

/** Paths never tracked in the configuration history. */
export const EXCLUDED_PATTERNS: readonly string[] = [
    '*.db', '*.db-*', '*.db-shm', '*.db-wal', '*.log', '*.log.*', 'home-assistant.log*',
    '/tts/', '/backups/', '/deps/', '/.cloud/', '__pycache__/', '*.pyc', '.git/', 'node_modules/',
    // HA internal state: changes constantly and must not be restored while HA runs (HA backups cover it)
    '/.storage/', '/.ha_run.lock', '/.HA_RESTORE',
    // Managed by HACS (thousands of downloaded files), not user configuration
    '/custom_components/hacs/', '/www/community/',
    '/media/', '*.mp4', '*.mkv', '*.jpg', '*.jpeg', '*.png',
]

const VERSION_ID_PATTERN = /^[0-9a-f]{7,40}$/
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const MAX_LIST_LIMIT = 200
const REPO_CONFIG: readonly [string, string][] = [
    ['core.bare', 'false'],
    ['core.quotepath', 'false'],
    ['core.autocrlf', 'false'],
    ['core.filemode', 'true'],
    ['commit.gpgsign', 'false'],
    ['gc.auto', '256'],
    ['user.name', 'AI automatizace'],
    ['user.email', 'ai@local'],
]

async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path)
        return true
    } catch {
        return false
    }
}

/** Optional labels used by restore(). */
export interface RestoreOptions {
    /** Kind of the snapshot taken from uncommitted changes before restoring (default 'manual'). */
    pendingKind?: VersionKind
    /** Title of that snapshot. */
    pendingTitle?: string
    /** Title of the restore version. */
    title?: string
    /** Chat that triggered the restore. */
    chatId?: string | null
}

/** Versioned history of the Home Assistant configuration directory backed by git with a separate git dir. */
export class ConfigHistory {
    private readonly git: GitRunner
    private readonly mutex = new Mutex()

    /**
     * @param haConfigDir tracked configuration directory (work tree)
     * @param gitDir repository directory outside the work tree
     */
    public constructor(haConfigDir: string, gitDir: string) {
        this.git = new GitRunner(gitDir, haConfigDir)
    }

    /** Creates the repository and the initial version when missing; idempotent. */
    public init(): Promise<void> {
        return this.mutex.runExclusive(async () => {
            await mkdir(this.git.workTree, { recursive: true })
            if (!await pathExists(join(this.git.gitDir, 'HEAD'))) {
                await mkdir(this.git.gitDir, { recursive: true, mode: 0o700 })
                await this.git.run(['init', '--quiet'])
            }
            await rm(join(this.git.gitDir, 'index.lock'), { force: true })
            for (const [key, value] of REPO_CONFIG) {
                await this.git.run(['config', key, value])
            }
            await mkdir(join(this.git.gitDir, 'info'), { recursive: true })
            await writeFile(join(this.git.gitDir, 'info', 'exclude'), `${EXCLUDED_PATTERNS.join('\n')}\n`)
            if (await this.resolveHead() === null) {
                await this.commitAll({ kind: 'initial', title: 'Výchozí stav konfigurace' }, true)
            } else if (await untrackExcludedFiles(this.git)) {
                await this.commitAll({ kind: 'manual', title: 'Úprava sledovaných souborů (vyřazení interních dat)' }, false)
            }
        })
    }

    /**
     * Commits all current changes of the work tree.
     *
     * @returns new version or null when nothing changed
     */
    public snapshot(input: SnapshotInput): Promise<VersionSummary | null> {
        return this.mutex.runExclusive(() => this.commitAll(input, false))
    }

    /**
     * Lists versions newest first.
     *
     * @param limit page size (1-200)
     * @param cursor id of the last version of the previous page
     */
    public list(limit: number, cursor: string | null): Promise<VersionListResponse> {
        return this.mutex.runExclusive(async () => {
            const pageSize = Math.min(Math.max(Math.trunc(limit) || 1, 1), MAX_LIST_LIMIT)
            const head = await this.requireHead()
            const start = cursor === null ? head : await this.resolveVersion(cursor)
            const skip = cursor === null ? 0 : 1
            const output = await this.git.output([
                'log', '--first-parent', '--no-renames', LOG_FORMAT, '--numstat',
                `--skip=${skip}`, `--max-count=${pageSize + 1}`, start, '--',
            ])
            const versions = parseLog(output, head)
            const hasMore = versions.length > pageSize
            const page = versions.slice(0, pageSize)
            return { versions: page, nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null }
        })
    }

    /**
     * Returns a version with per-file diffs against its parent.
     *
     * @throws HistoryError on invalid or unknown id
     */
    public detail(versionId: string): Promise<VersionDetail> {
        return this.mutex.runExclusive(async () => {
            const sha = await this.resolveVersion(versionId)
            const summary = await this.summary(sha)
            const parent = await this.parentOf(sha)
            const files = parent === null
                ? await collectDiffs(this.git, [EMPTY_TREE, sha], false)
                : await collectDiffs(this.git, [parent, sha])
            return { ...summary, files }
        })
    }

    /** Returns the sha of the current version (HEAD). */
    public currentVersionId(): Promise<string> {
        return this.mutex.runExclusive(() => this.requireHead())
    }

    /**
     * Makes the work tree equal to the given version and records it as a new 'restore' version.
     *
     * @param options labels for the snapshot of uncommitted changes and for the restore version
     * @returns the restore version (null when already equal) and paths that changed
     * @throws HistoryError on invalid or unknown id
     */
    public restore(
        versionId: string,
        userName: string,
        options: RestoreOptions = {},
    ): Promise<{ version: VersionSummary | null, changedPaths: string[] }> {
        return this.mutex.runExclusive(async () => {
            const target = await this.resolveVersion(versionId)
            await this.commitAll({
                kind: options.pendingKind ?? 'manual',
                title: options.pendingTitle ?? 'Změny provedené mimo AI (před obnovením)',
                chatId: options.chatId ?? null,
                userName,
            }, false)
            const changes = await collectDiffs(this.git, ['HEAD', target], false)
            if (changes.length === 0) {
                return { version: null, changedPaths: [] }
            }
            await this.git.run(['read-tree', '-u', '--reset', target])
            const version = await this.commitAll({
                kind: 'restore',
                title: options.title ?? `Obnovení verze ${target.slice(0, 7)}`,
                chatId: options.chatId ?? null,
                userName,
                restoredFrom: target,
            }, false)
            return { version, changedPaths: changes.map((change) => change.path) }
        })
    }

    /** Returns uncommitted changes of the work tree against the current version. */
    public diffWorkTree(): Promise<FileDiff[]> {
        return this.mutex.runExclusive(async () => {
            await this.git.run(['add', '--all', '--', '.'])
            return await collectDiffs(this.git, ['--cached', 'HEAD'])
        })
    }

    private async commitAll(input: SnapshotInput, allowEmpty: boolean): Promise<VersionSummary | null> {
        await this.git.run(['add', '--all', '--', '.'])
        const hasHead = await this.resolveHead() !== null
        if (hasHead && !allowEmpty) {
            const staged = await this.git.run(['diff', '--cached', '--quiet', 'HEAD', '--'], { acceptExitCodes: [1] })
            if (staged.exitCode === 0) {
                return null
            }
        }
        const [title, trailers] = buildCommitMessage({
            kind: input.kind,
            title: input.title,
            chatId: input.chatId ?? null,
            userName: input.userName ?? null,
            restoredFrom: input.restoredFrom ?? null,
        })
        const args = ['commit', '--quiet', '--no-verify', '--cleanup=whitespace', '-m', title, '-m', trailers]
        await this.git.run(allowEmpty ? [...args, '--allow-empty'] : args)
        return await this.summary(await this.requireHead())
    }

    private async summary(sha: string): Promise<VersionSummary> {
        const head = await this.requireHead()
        const output = await this.git.output(['log', '--no-renames', LOG_FORMAT, '--numstat', '--max-count=1', sha, '--'])
        const version = parseLog(output, head)[0]
        if (version === undefined) {
            throw new HistoryError('Verze nebyla nalezena.', 404)
        }
        return version
    }

    private async parentOf(sha: string): Promise<string | null> {
        const result = await this.git.run(['rev-parse', '--verify', '--quiet', `${sha}^1`], { acceptExitCodes: [1, 128] })
        return result.exitCode === 0 ? result.stdout.trim() : null
    }

    private async resolveHead(): Promise<string | null> {
        const result = await this.git.run(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { acceptExitCodes: [1, 128] })
        return result.exitCode === 0 ? result.stdout.trim() : null
    }

    private async requireHead(): Promise<string> {
        const head = await this.resolveHead()
        if (head === null) {
            throw new HistoryError('Historie konfigurace není inicializována.', 500)
        }
        return head
    }

    private async resolveVersion(versionId: string): Promise<string> {
        if (typeof versionId !== 'string' || !VERSION_ID_PATTERN.test(versionId)) {
            throw new HistoryError('Neplatný identifikátor verze.', 400)
        }
        const result = await this.git.run(['rev-parse', '--verify', '--quiet', `${versionId}^{commit}`], { acceptExitCodes: [1, 128] })
        if (result.exitCode !== 0) {
            throw new HistoryError('Verze nebyla nalezena.', 404)
        }
        return result.stdout.trim()
    }
}
