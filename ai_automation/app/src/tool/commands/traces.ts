/**
 * `automation-trace <automation_id|automation.entity_id> [--limit N] [--run RUN_ID]` command.
 */
import {
    ToolError,
    asRecord,
    asString,
    getIntOption,
    getStringOption,
    requirePositional,
    type ParsedArgs,
} from '../cli.js'
import {
    AUTOMATION_ITEM_ID_PATTERN,
    TRACE_RUN_ID_PATTERN,
    isValidEntityId,
} from '../validation.js'
import {
    jsonResult,
    type CommandResult,
    type ToolContext,
} from '../types.js'

const DEFAULT_TRACE_COUNT = 5
const MAX_TRACE_COUNT = 50

interface HaStateLite {
    attributes?: Record<string, unknown>
}

/** Resolves the automation config id (`id:` in YAML) from either the id or its entity id. */
async function resolveItemId(value: string, context: ToolContext): Promise<string> {
    if (value.startsWith('automation.') && isValidEntityId(value)) {
        const state = await context.client.core<HaStateLite>('GET', `/api/states/${value}`)
        const configId = asString(state.attributes?.id)
        if (configId === null) {
            throw new ToolError(`${value} has no "id" attribute – automations without id have no traces.`)
        }
        return configId
    }
    if (!AUTOMATION_ITEM_ID_PATTERN.test(value)) {
        throw new ToolError(`Invalid automation id "${value}"`)
    }
    return value
}

function traceStart(trace: unknown): string {
    return asString(asRecord(asRecord(trace)?.timestamp)?.start) ?? ''
}

/** Lists the latest traces and prints the full newest (or selected) trace. */
export async function automationTraceCommand(args: ParsedArgs, context: ToolContext): Promise<CommandResult> {
    const itemId = await resolveItemId(requirePositional(args, 0, 'automation-trace <automation_id>'), context)
    const limit = getIntOption(args, 'limit', DEFAULT_TRACE_COUNT, 1, MAX_TRACE_COUNT)
    const runOption = getStringOption(args, 'run')
    if (runOption !== null && !TRACE_RUN_ID_PATTERN.test(runOption)) {
        throw new ToolError(`Invalid run id "${runOption}"`)
    }
    const traces = await context.client.coreWs<unknown[]>({ type: 'trace/list', domain: 'automation', item_id: itemId })
    const latest = [...traces].sort((left, right) => traceStart(right).localeCompare(traceStart(left))).slice(0, limit)
    const runId = runOption ?? asString(asRecord(latest[0])?.run_id)
    if (runId === null) {
        return jsonResult({ item_id: itemId, traces: [], note: 'No traces yet – the automation has not run since the last restart/reload.' })
    }
    const detail = await context.client.coreWs<unknown>({ type: 'trace/get', domain: 'automation', item_id: itemId, run_id: runId })
    return jsonResult({ item_id: itemId, traces: latest, detail })
}
