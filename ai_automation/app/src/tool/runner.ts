/**
 * Dispatches parsed arguments to commands and handles output and errors.
 */
import {
    ToolError,
    parseArgs,
} from './cli.js'
import { HELP_TEXT } from './help.js'
import { redactSecret } from './rawHttp.js'
import type {
    CommandHandler,
    CommandResult,
    ToolContext,
} from './types.js'

/** Output sinks (injectable for tests). */
export interface ToolIo {
    stdout: (text: string) => void
    stderr: (text: string) => void
}

/** Dependencies of the runner. */
export interface RunnerDeps {
    commands: ReadonlyMap<string, CommandHandler>
    createContext: () => ToolContext
    io: ToolIo
}

const HELP_COMMANDS: ReadonlySet<string> = new Set(['help', '--help', '-h'])

function renderResult(result: CommandResult): string {
    if (result.text === true && typeof result.output === 'string') {
        return result.output
    }
    return JSON.stringify(result.output ?? null, null, 4)
}

function secretFromEnv(): string {
    return process.env.SUPERVISOR_TOKEN ?? ''
}

/**
 * Runs haos-tool with the given argv (without node/script) and returns the exit code.
 */
export async function runCli(argv: readonly string[], deps: RunnerDeps): Promise<number> {
    try {
        const args = parseArgs(argv)
        if (HELP_COMMANDS.has(args.command) || args.options.help === true) {
            deps.io.stdout(HELP_TEXT)
            return 0
        }
        const handler = deps.commands.get(args.command)
        if (handler === undefined) {
            throw new ToolError(`Unknown command "${args.command}". Run "haos-tool help".`)
        }
        const result = await handler(args, deps.createContext())
        deps.io.stdout(redactSecret(renderResult(result), secretFromEnv()))
        return result.exitCode ?? 0
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        deps.io.stderr(`haos-tool error: ${redactSecret(message, secretFromEnv())}`)
        return error instanceof ToolError ? error.exitCode : 1
    }
}
