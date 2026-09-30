/**
 * `check-config`, `reload` and `restart-core` commands.
 */
import {
    requirePositional,
    type ParsedArgs,
} from '../cli.js'
import {
    normalizeCheckResult,
    resolveReloadService,
    type CheckConfigOutput,
} from '../reloadMap.js'
import {
    jsonResult,
    type CommandResult,
    type ToolContext,
} from '../types.js'

/** Exit code used when the configuration is invalid. */
export const EXIT_CONFIG_INVALID = 2
const RESTART_TIMEOUT_MS = 5 * 60_000

/** Runs HA core configuration check. */
export async function runCheckConfig(context: ToolContext): Promise<CheckConfigOutput> {
    const response = await context.client.core<unknown>('POST', '/api/config/core/check_config')
    return normalizeCheckResult(response)
}

/** `haos-tool check-config` – exit 0 when valid, 2 when invalid. */
export async function checkConfigCommand(_args: ParsedArgs, context: ToolContext): Promise<CommandResult> {
    const result = await runCheckConfig(context)
    return jsonResult(result, result.valid ? 0 : EXIT_CONFIG_INVALID)
}

/** `haos-tool reload <target>` – validates configuration first, refuses when invalid. */
export async function reloadCommand(args: ParsedArgs, context: ToolContext): Promise<CommandResult> {
    const target = requirePositional(args, 0, 'reload <automation|script|scene|group|template|input_*|core|all>')
    const { domain, service } = resolveReloadService(target)
    const check = await runCheckConfig(context)
    if (!check.valid) {
        return jsonResult({ reloaded: false, reason: 'Configuration is invalid – fix it first.', check }, EXIT_CONFIG_INVALID)
    }
    await context.client.core<unknown>('POST', `/api/services/${domain}/${service}`, {})
    return jsonResult({ reloaded: true, service: `${domain}.${service}` })
}

/** `haos-tool restart-core` – only after a valid configuration check. */
export async function restartCoreCommand(_args: ParsedArgs, context: ToolContext): Promise<CommandResult> {
    const check = await runCheckConfig(context)
    if (!check.valid) {
        return jsonResult({ restarted: false, reason: 'Configuration is invalid – restart refused.', check }, 1)
    }
    await context.http.supervisorJson({ method: 'POST', path: '/core/restart', timeoutMs: RESTART_TIMEOUT_MS })
    return jsonResult({
        restarted: true,
        note: 'Home Assistant Core is restarting (usually 1–3 minutes). Wait, then verify with "haos-tool entities".',
    })
}
