/**
 * `entities` and `entity` commands.
 */
import {
    ToolError,
    getIntOption,
    getStringOption,
    requirePositional,
    type ParsedArgs,
} from '../cli.js'
import {
    areaNameMap,
    buildEntityRows,
    deviceDisplayName,
    effectiveAreaId,
    filterEntityRows,
    loadRegistry,
} from '../entityIndex.js'
import {
    assertDomain,
    assertEntityId,
} from '../validation.js'
import {
    jsonResult,
    type CommandResult,
    type ToolContext,
} from '../types.js'

const DEFAULT_ENTITY_LIMIT = 200
const MAX_ENTITY_LIMIT = 10_000

/** `haos-tool entities [--domain D] [--search TEXT] [--area AREA] [--limit N]` */
export async function entitiesCommand(args: ParsedArgs, context: ToolContext): Promise<CommandResult> {
    const domain = getStringOption(args, 'domain')
    const filter = {
        domain: domain === null ? null : assertDomain(domain),
        search: getStringOption(args, 'search') ?? args.positionals[0] ?? null,
        area: getStringOption(args, 'area'),
    }
    const limit = getIntOption(args, 'limit', DEFAULT_ENTITY_LIMIT, 1, MAX_ENTITY_LIMIT)
    const snapshot = await loadRegistry(context.client)
    const rows = filterEntityRows(buildEntityRows(snapshot), filter, snapshot.areas)
    const shown = rows.slice(0, limit)
    const output: Record<string, unknown> = { total: rows.length, shown: shown.length, entities: shown }
    if (rows.length > limit) {
        output.note = `Truncated: showing ${limit} of ${rows.length}. Narrow with --domain/--search/--area or use --limit N.`
    }
    return jsonResult(output)
}

/** `haos-tool entity <entity_id>` – full state, registry entry and device. */
export async function entityCommand(args: ParsedArgs, context: ToolContext): Promise<CommandResult> {
    const entityId = assertEntityId(requirePositional(args, 0, 'entity <entity_id>'))
    const snapshot = await loadRegistry(context.client)
    const state = snapshot.states.find((item) => item.entity_id === entityId) ?? null
    const listEntry = snapshot.entities.find((item) => item.entity_id === entityId)
    if (state === null && listEntry === undefined) {
        throw new ToolError(`Entity ${entityId} not found (try: haos-tool entities --search <text>)`)
    }
    const registryEntry = listEntry === undefined
        ? null
        : await context.client.coreWs<unknown>({ type: 'config/entity_registry/get', entity_id: entityId })
            .catch(() => listEntry)
    const device = listEntry?.device_id
        ? snapshot.devices.find((item) => item.id === listEntry.device_id)
        : undefined
    const areaId = effectiveAreaId(listEntry, device)
    return jsonResult({
        entity_id: entityId,
        state,
        area: areaId === null ? null : { area_id: areaId, name: areaNameMap(snapshot.areas).get(areaId) ?? null },
        registry: registryEntry,
        device: device === undefined ? null : { ...device, display_name: deviceDisplayName(device) },
        note: listEntry === undefined ? 'Entity has no registry entry (no unique_id) – it cannot be renamed/assigned in the UI.' : undefined,
    })
}
