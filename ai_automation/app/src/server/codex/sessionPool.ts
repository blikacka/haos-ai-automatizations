import { EventEmitter } from 'node:events'
import {
    chmod,
    copyFile,
    mkdir,
    writeFile,
} from 'node:fs/promises'
import {
    delimiter,
    dirname,
    join,
    resolve,
} from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppEnv } from '../config/env.js'
import { userDirName } from '../util/ids.js'
import { logger } from '../util/logger.js'
import { CodexSession } from './codexSession.js'

/** Sessions without an active turn are stopped after this time. */
export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000

const DIR_MODE = 0o700
const FILE_MODE = 0o600
const AGENTS_FILE = 'AGENTS.md'

/** config.toml written into a fresh CODEX_HOME (never overwritten). */
export const DEFAULT_CODEX_CONFIG = `cli_auth_credentials_store = "file"
approval_policy = "never"
sandbox_mode = "danger-full-access"
[shell_environment_policy]
inherit = "all"
[features]
`

/**
 * Resolves the application root (directory with package.json) from a module URL
 * located in <root>/{src,dist}/server/codex.
 *
 * @param moduleUrl import.meta.url of a module in this directory
 * @returns absolute application root
 */
export function resolveAppRoot(moduleUrl: string = import.meta.url): string {
    return resolve(dirname(fileURLToPath(moduleUrl)), '..', '..', '..')
}

/**
 * Directory of one HA user inside the data dir.
 *
 * @param dataDir add-on data dir
 * @param userId HA user id
 * @returns absolute path
 */
export function userDataDir(dataDir: string, userId: string): string {
    return join(dataDir, 'users', userDirName(userId))
}

/**
 * Builds the environment of a Codex process.
 *
 * @param baseEnv inherited environment
 * @param userDir HA user dir (HOME)
 * @param codexHome CODEX_HOME
 * @param appRoot application root (its bin dir is put first on PATH)
 * @returns environment for spawn
 */
export function buildCodexEnv(baseEnv: NodeJS.ProcessEnv, userDir: string, codexHome: string, appRoot: string): NodeJS.ProcessEnv {
    const currentPath = baseEnv.PATH ?? ''
    const binDir = join(appRoot, 'bin')
    return {
        ...baseEnv,
        CODEX_HOME: codexHome,
        HOME: userDir,
        PATH: currentPath === '' ? binDir : `${binDir}${delimiter}${currentPath}`,
    }
}

/**
 * Prepares CODEX_HOME: creates the directory (0700), writes config.toml when absent
 * and copies the current AGENTS.md.
 *
 * @param codexHome CODEX_HOME path
 * @param agentDir directory with AGENTS.md
 */
export async function prepareCodexHome(codexHome: string, agentDir: string): Promise<void> {
    await mkdir(codexHome, { recursive: true, mode: DIR_MODE })
    await chmod(codexHome, DIR_MODE)
    try {
        await writeFile(join(codexHome, 'config.toml'), DEFAULT_CODEX_CONFIG, { mode: FILE_MODE, flag: 'wx' })
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw error
        }
    }
    try {
        await copyFile(join(agentDir, AGENTS_FILE), join(codexHome, AGENTS_FILE))
    } catch (error) {
        logger.warn('Cannot copy AGENTS.md to CODEX_HOME', { error })
    }
}

/** Factory creating sessions (replaceable in tests). */
export type CodexSessionFactory = (options: ConstructorParameters<typeof CodexSession>[0]) => CodexSession

/** Tunables of the pool. */
export interface SessionPoolOptions {
    idleTimeoutMs?: number
    sessionFactory?: CodexSessionFactory
    appRoot?: string
}

interface PoolEntry {
    session: CodexSession | null
    starting: Promise<CodexSession> | null
    busy: boolean
    idleTimer: NodeJS.Timeout | null
}

/**
 * Lazily started Codex app-server processes, one per HA user.
 * Emits 'session' (userId, session) whenever a new session has started.
 */
export class CodexSessionPool extends EventEmitter {
    private readonly entries = new Map<string, PoolEntry>()
    private readonly idleTimeoutMs: number
    private readonly sessionFactory: CodexSessionFactory
    private readonly appRoot: string

    /**
     * @param env application environment
     * @param options optional tunables
     */
    public constructor(private readonly env: AppEnv, options: SessionPoolOptions = {}) {
        super()
        this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
        this.sessionFactory = options.sessionFactory ?? ((sessionOptions) => new CodexSession(sessionOptions))
        this.appRoot = options.appRoot ?? resolveAppRoot()
    }

    /**
     * Returns the running session of a user, starting (or restarting after a crash) it when needed.
     *
     * @param userId HA user id
     * @returns started session
     */
    public async get(userId: string): Promise<CodexSession> {
        const entry = this.entryFor(userId)
        if (entry.session !== null && entry.session.isRunning) {
            this.armIdleTimer(userId, entry)
            return entry.session
        }
        if (entry.starting === null) {
            entry.starting = this.startSession(userId, entry).finally(() => {
                entry.starting = null
            })
        }
        return entry.starting
    }

    /**
     * Marks a user's session busy (active turn) or idle; idle sessions stop after the timeout.
     *
     * @param userId HA user id
     * @param busy whether a turn is running
     */
    public markBusy(userId: string, busy: boolean): void {
        const entry = this.entryFor(userId)
        entry.busy = busy
        this.armIdleTimer(userId, entry)
    }

    /** Stops all sessions. */
    public async stopAll(): Promise<void> {
        const sessions: CodexSession[] = []
        for (const entry of this.entries.values()) {
            this.clearIdleTimer(entry)
            if (entry.session !== null) {
                sessions.push(entry.session)
                entry.session = null
            }
        }
        await Promise.all(sessions.map((session) => session.stop()))
    }

    private entryFor(userId: string): PoolEntry {
        let entry = this.entries.get(userId)
        if (entry === undefined) {
            entry = { session: null, starting: null, busy: false, idleTimer: null }
            this.entries.set(userId, entry)
        }
        return entry
    }

    private async startSession(userId: string, entry: PoolEntry): Promise<CodexSession> {
        const userDir = userDataDir(this.env.dataDir, userId)
        const codexHome = join(userDir, 'codex')
        await prepareCodexHome(codexHome, this.env.agentDir)
        const session = this.sessionFactory({
            codexBin: this.env.codexBin,
            codexHome,
            cwd: this.env.haConfigDir,
            env: buildCodexEnv(process.env, userDir, codexHome, this.appRoot),
            clientVersion: this.env.addonVersion,
        })
        session.on('exit', (code: number | null) => {
            if (entry.session === session) {
                logger.warn('Codex session ended', { userDir: userDirName(userId), code })
                entry.session = null
                this.clearIdleTimer(entry)
            }
        })
        await session.start()
        entry.session = session
        this.armIdleTimer(userId, entry)
        this.emit('session', userId, session)
        return session
    }

    private armIdleTimer(userId: string, entry: PoolEntry): void {
        this.clearIdleTimer(entry)
        if (entry.session === null && entry.starting === null) {
            return
        }
        entry.idleTimer = setTimeout(() => this.handleIdle(userId, entry), this.idleTimeoutMs)
        entry.idleTimer.unref()
    }

    private handleIdle(userId: string, entry: PoolEntry): void {
        entry.idleTimer = null
        if (entry.busy) {
            this.armIdleTimer(userId, entry)
            return
        }
        const session = entry.session
        if (session === null) {
            return
        }
        entry.session = null
        logger.info('Stopping idle Codex session', { userDir: userDirName(userId) })
        session.stop().catch((error: unknown) => logger.warn('Stopping idle session failed', { error }))
    }

    private clearIdleTimer(entry: PoolEntry): void {
        if (entry.idleTimer !== null) {
            clearTimeout(entry.idleTimer)
            entry.idleTimer = null
        }
    }
}
