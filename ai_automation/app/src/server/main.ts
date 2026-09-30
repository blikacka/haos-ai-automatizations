import {
    copyFile,
    mkdir,
} from 'node:fs/promises'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { ChatRunner } from './chats/chatRunner.js'
import { ChatStore } from './chats/chatStore.js'
import { AccountService } from './codex/accountService.js'
import { ModelService } from './codex/modelService.js'
import { CodexSessionPool } from './codex/sessionPool.js'
import {
    type AppEnv,
    loadAddonOptions,
    loadEnv,
} from './config/env.js'
import { ConfigGuard } from './ha/configGuard.js'
import { SupervisorClient } from './ha/supervisorClient.js'
import { ConfigHistory } from './history/configHistory.js'
import { RestoreService } from './history/restoreService.js'
import { EventHub } from './http/eventHub.js'
import { createAppServer } from './http/server.js'
import { recoverInterruptedChats } from './startupRecovery.js'
import {
    logger,
    setLogLevel,
} from './util/logger.js'

const LISTEN_HOST = '0.0.0.0'
const SHUTDOWN_TIMEOUT_MS = 10_000

function errorText(error: unknown): string {
    return error instanceof Error ? (error.stack ?? error.message) : String(error)
}

/**
 * Copy the Codex instructions (AGENTS.md) into persistent storage so sessions can reference them.
 */
async function installAgentInstructions(env: AppEnv): Promise<void> {
    const targetDir = join(env.dataDir, 'agent')
    try {
        await mkdir(targetDir, { recursive: true, mode: 0o700 })
        await copyFile(join(env.agentDir, 'AGENTS.md'), join(targetDir, 'AGENTS.md'))
    } catch (error) {
        logger.warn('Copying AGENTS.md failed', { error: errorText(error) })
    }
}

function listen(server: Server, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, LISTEN_HOST, () => {
            server.off('error', reject)
            resolve()
        })
    })
}

function registerShutdown(server: Server, pool: CodexSessionPool): void {
    let stopping = false
    const shutdown = (signal: string): void => {
        if (stopping) {
            return
        }
        stopping = true
        logger.info('Shutting down', { signal })
        const forceExit = setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS)
        forceExit.unref()
        server.close()
        server.closeAllConnections()
        pool.stopAll()
            .catch((error: unknown) => logger.error('Stopping Codex sessions failed', { error: errorText(error) }))
            .finally(() => process.exit(0))
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))
}

/**
 * Composition root: wires all services together and starts the HTTP server.
 */
async function main(): Promise<void> {
    const env = loadEnv()
    setLogLevel(loadAddonOptions(env.dataDir).logLevel)
    logger.info('Starting AI automatizace', { version: env.addonVersion, port: env.port })

    const client = new SupervisorClient(env.supervisorUrl, env.supervisorToken)
    const guard = new ConfigGuard(client)
    const history = new ConfigHistory(env.haConfigDir, `${env.dataDir}/history.git`)
    await history.init()
    const restore = new RestoreService(history, guard)
    await installAgentInstructions(env)
    await recoverInterruptedChats(env.dataDir)

    const hub = new EventHub()
    const pool = new CodexSessionPool(env)
    const accounts = new AccountService(pool, hub)
    const models = new ModelService(pool)
    const store = new ChatStore(env.dataDir)
    const runner = new ChatRunner({ store, pool, hub, history, guard, env })

    const server = createAppServer({ env, hub, accounts, models, store, runner, history, restore, guard })
    registerShutdown(server, pool)
    await listen(server, env.port)
    logger.info('HTTP server listening', { host: LISTEN_HOST, port: env.port })
}

main().catch((error: unknown) => {
    logger.error('Fatal startup error', { error: errorText(error) })
    process.exit(1)
})
