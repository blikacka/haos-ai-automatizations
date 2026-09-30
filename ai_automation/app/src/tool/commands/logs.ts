/**
 * `logs [core|supervisor|host] [--lines N] [--grep TEXT]` command.
 */
import {
    ToolError,
    getIntOption,
    getStringOption,
    type ParsedArgs,
} from '../cli.js'
import {
    isLogSource,
    selectLogLines,
    type LogSource,
} from '../logText.js'
import {
    textResult,
    type CommandResult,
    type ToolContext,
} from '../types.js'

const DEFAULT_LOG_LINES = 200
const MAX_LOG_LINES = 5_000

const SUPERVISOR_LOG_PATHS: Readonly<Record<LogSource, string>> = {
    core: '/core/logs',
    supervisor: '/supervisor/logs',
    host: '/host/logs',
}
const CORE_ERROR_LOG_PATH = '/core/api/error_log'

async function fetchLogText(source: LogSource, context: ToolContext): Promise<string> {
    try {
        return await context.http.text(SUPERVISOR_LOG_PATHS[source])
    } catch (error) {
        if (source !== 'core') {
            throw error
        }
        return context.http.text(CORE_ERROR_LOG_PATH)
    }
}

/** Prints the tail of the selected log as plain text. */
export async function logsCommand(args: ParsedArgs, context: ToolContext): Promise<CommandResult> {
    const source = args.positionals[0] ?? 'core'
    if (!isLogSource(source)) {
        throw new ToolError(`Unknown log source "${source}" (use core, supervisor or host)`)
    }
    const lines = getIntOption(args, 'lines', DEFAULT_LOG_LINES, 1, MAX_LOG_LINES)
    const grep = getStringOption(args, 'grep')
    const text = selectLogLines(await fetchLogText(source, context), lines, grep)
    return textResult(text === '' ? `(no ${source} log lines${grep === null ? '' : ` matching "${grep}"`})` : text)
}
