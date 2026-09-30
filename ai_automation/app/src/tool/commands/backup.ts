/**
 * `backup`, `addons` and `addon` commands (Supervisor).
 */
import {
    asRecord,
    asString,
    requirePositional,
    type ParsedArgs,
} from '../cli.js'
import { assertAddonSlug } from '../validation.js'
import {
    jsonResult,
    type CommandResult,
    type ToolContext,
} from '../types.js'

const BACKUP_TIMEOUT_MS = 10 * 60_000
const MAX_BACKUP_NAME_LENGTH = 100

/** `haos-tool backup "<name>"` – partial backup of the HA configuration. */
export async function backupCommand(args: ParsedArgs, context: ToolContext): Promise<CommandResult> {
    const name = requirePositional(args, 0, 'backup "<name>"')
        .replace(/[\r\n]+/g, ' ')
        .trim()
        .slice(0, MAX_BACKUP_NAME_LENGTH)
    const data = await context.http.supervisorJson({
        method: 'POST',
        path: '/backups/new/partial',
        body: { name, homeassistant: true },
        timeoutMs: BACKUP_TIMEOUT_MS,
    })
    return jsonResult({ created: true, name, backup: data })
}

/** `haos-tool addons` – installed add-ons (compact). */
export async function addonsCommand(_args: ParsedArgs, context: ToolContext): Promise<CommandResult> {
    const data = asRecord(await context.client.supervisor<unknown>('GET', '/addons')) ?? {}
    const addons = Array.isArray(data.addons) ? data.addons : []
    return jsonResult(addons.map((item: unknown) => {
        const addon = asRecord(item) ?? {}
        return {
            slug: asString(addon.slug),
            name: asString(addon.name),
            state: asString(addon.state),
            version: asString(addon.version),
            update_available: addon.update_available === true,
        }
    }))
}

/** `haos-tool addon <slug>` – add-on details (options are omitted to avoid leaking secrets). */
export async function addonCommand(args: ParsedArgs, context: ToolContext): Promise<CommandResult> {
    const slug = assertAddonSlug(requirePositional(args, 0, 'addon <slug>'))
    const info = asRecord(await context.client.supervisor<unknown>('GET', `/addons/${slug}/info`)) ?? {}
    return jsonResult({ ...info, options: 'hidden (may contain passwords)' })
}
