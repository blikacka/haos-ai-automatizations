/**
 * Shared types of haos-tool commands.
 */
import type { AppEnv } from '../server/config/env.js'
import type { SupervisorClient } from '../server/ha/supervisorClient.js'
import type { ParsedArgs } from './cli.js'
import type { RawHttp } from './rawHttp.js'

/** Runtime dependencies available to every command. */
export interface ToolContext {
    env: AppEnv
    client: SupervisorClient
    http: RawHttp
}

/** What a command produces: JSON output (default) or plain text. */
export interface CommandResult {
    output: unknown
    text?: boolean
    exitCode?: number
}

/** A command implementation. */
export type CommandHandler = (args: ParsedArgs, context: ToolContext) => Promise<CommandResult>

/** Wraps a value as a JSON command result. */
export function jsonResult(output: unknown, exitCode = 0): CommandResult {
    return { output, exitCode }
}

/** Wraps text as a plain text command result. */
export function textResult(output: string): CommandResult {
    return { output, text: true, exitCode: 0 }
}
