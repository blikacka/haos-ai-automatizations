import { execFile } from 'node:child_process'

const MAX_BUFFER_BYTES = 64 * 1024 * 1024
const GIT_TIMEOUT_MS = 120_000
const AUTHOR_NAME = 'AI automatizace'
const AUTHOR_EMAIL = 'ai@local'

/** Inherited variables that would redirect git to another repository. */
const STRIPPED_ENV_KEYS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_CEILING_DIRECTORIES']

/** Result of a git invocation. */
export interface GitResult {
    stdout: string
    stderr: string
    exitCode: number
}

/** Options of a single git invocation. */
export interface GitRunOptions {
    /** Exit codes that are not treated as failure (0 is always accepted). */
    acceptExitCodes?: number[]
}

/** Error thrown when git exits with an unexpected code. */
export class GitError extends Error {
    public readonly exitCode: number
    public readonly stderr: string

    /**
     * @param message description including the git subcommand
     * @param exitCode git exit code (-1 when the process failed to run)
     * @param stderr captured stderr
     */
    public constructor(message: string, exitCode: number, stderr: string) {
        super(message)
        this.name = 'GitError'
        this.exitCode = exitCode
        this.stderr = stderr
    }
}

function buildEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !STRIPPED_ENV_KEYS.includes(key)),
    )
    return {
        ...env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_OPTIONAL_LOCKS: '0',
        LC_ALL: 'C',
        GIT_AUTHOR_NAME: AUTHOR_NAME,
        GIT_AUTHOR_EMAIL: AUTHOR_EMAIL,
        GIT_COMMITTER_NAME: AUTHOR_NAME,
        GIT_COMMITTER_EMAIL: AUTHOR_EMAIL,
    }
}

/** Runs git with a separate git dir and work tree (never a shell, only argument arrays). */
export class GitRunner {
    public readonly gitDir: string
    public readonly workTree: string
    private readonly env: NodeJS.ProcessEnv = buildEnv()

    /**
     * @param gitDir repository directory (e.g. /data/history.git)
     * @param workTree tracked directory (e.g. /homeassistant)
     */
    public constructor(gitDir: string, workTree: string) {
        this.gitDir = gitDir
        this.workTree = workTree
    }

    /**
     * Executes `git --git-dir <gitDir> --work-tree <workTree> ...args` in the work tree.
     *
     * @param args git arguments (subcommand first)
     * @param options accepted exit codes
     * @returns stdout / stderr / exit code
     * @throws GitError when git fails
     */
    public run(args: string[], options: GitRunOptions = {}): Promise<GitResult> {
        const fullArgs = ['-c', 'safe.directory=*', '--git-dir', this.gitDir, '--work-tree', this.workTree, ...args]
        const accepted = options.acceptExitCodes ?? []
        return new Promise<GitResult>((resolvePromise, rejectPromise) => {
            execFile('git', fullArgs, {
                cwd: this.workTree,
                env: this.env,
                maxBuffer: MAX_BUFFER_BYTES,
                timeout: GIT_TIMEOUT_MS,
                encoding: 'utf8',
                windowsHide: true,
            }, (error, stdout, stderr) => {
                const exitCode = error === null ? 0 : typeof error.code === 'number' ? error.code : -1
                if (exitCode === 0 || accepted.includes(exitCode)) {
                    resolvePromise({ stdout, stderr, exitCode })
                    return
                }
                const reason = exitCode === -1 && error !== null ? error.message : stderr.trim()
                rejectPromise(new GitError(`git ${args[0] ?? ''} failed (${exitCode}): ${reason}`, exitCode, stderr))
            })
        })
    }

    /**
     * Runs git and returns trimmed stdout.
     *
     * @throws GitError when git fails
     */
    public async output(args: string[]): Promise<string> {
        const result = await this.run(args)
        return result.stdout.trim()
    }
}
