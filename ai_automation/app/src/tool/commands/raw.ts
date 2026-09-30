/**
 * Raw passthrough commands: `ws`, `api`, `supervisor`.
 */
import {
    parseJsonObject,
    requirePositional,
    type ParsedArgs,
} from '../cli.js'
import { parseJsonBody } from '../rawHttp.js'
import {
    assertCoreRequestAllowed,
    assertSupervisorRequestAllowed,
    assertWsMessageAllowed,
} from '../safety.js'
import {
    assertApiPath,
    parseRawMethod,
    type RawMethod,
} from '../validation.js'
import {
    jsonResult,
    type CommandResult,
    type ToolContext,
} from '../types.js'

interface RawCall {
    method: RawMethod
    path: string
    body: Record<string, unknown> | undefined
}

function parseRawCall(args: ParsedArgs, usage: string): RawCall {
    const method = parseRawMethod(requirePositional(args, 0, usage))
    const path = assertApiPath(requirePositional(args, 1, usage))
    const bodyText = args.positionals[2]
    return { method, path, body: bodyText === undefined ? undefined : parseJsonObject(bodyText, 'Request body') }
}

async function performRaw(context: ToolContext, call: RawCall, urlPath: string): Promise<CommandResult> {
    const response = await context.http.request({ method: call.method, path: urlPath, body: call.body })
    const ok = response.status >= 200 && response.status < 300
    return jsonResult({ status: response.status, body: parseJsonBody(response.text) }, ok ? 0 : 1)
}

/** `haos-tool ws '<json>'` – one raw core websocket command. */
export async function wsCommand(args: ParsedArgs, context: ToolContext): Promise<CommandResult> {
    const message = parseJsonObject(requirePositional(args, 0, "ws '<json>'"), 'Websocket message')
    delete message.id
    assertWsMessageAllowed(message)
    return jsonResult(await context.client.coreWs<unknown>(message))
}

/** `haos-tool api <GET|POST> <path> [json]` – raw core REST (path like /api/config). */
export async function apiCommand(args: ParsedArgs, context: ToolContext): Promise<CommandResult> {
    const call = parseRawCall(args, 'api <GET|POST> <path> [json]')
    assertCoreRequestAllowed(call.method, call.path)
    return performRaw(context, call, `/core${call.path}`)
}

/** `haos-tool supervisor <GET|POST> <path> [json]` – raw supervisor REST. */
export async function supervisorCommand(args: ParsedArgs, context: ToolContext): Promise<CommandResult> {
    const call = parseRawCall(args, 'supervisor <GET|POST> <path> [json]')
    assertSupervisorRequestAllowed(call.method, call.path)
    return performRaw(context, call, call.path)
}
