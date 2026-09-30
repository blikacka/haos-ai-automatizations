/**
 * `areas`, `devices` and `integrations` commands.
 */
import {
    asRecord,
    asString,
    getStringOption,
    type ParsedArgs,
} from '../cli.js'
import {
    areaNameMap,
    deviceDisplayName,
    loadRegistry,
} from '../entityIndex.js'
import { matchesSearch } from '../search.js'
import {
    jsonResult,
    type CommandResult,
    type ToolContext,
} from '../types.js'

/** `haos-tool areas` */
export async function areasCommand(_args: ParsedArgs, context: ToolContext): Promise<CommandResult> {
    const snapshot = await loadRegistry(context.client)
    const devicesById = new Map(snapshot.devices.map((device) => [device.id, device]))
    const entityCounts = new Map<string, number>()
    for (const entry of snapshot.entities) {
        const device = entry.device_id ? devicesById.get(entry.device_id) : undefined
        const areaId = entry.area_id ?? device?.area_id ?? null
        if (areaId !== null) {
            entityCounts.set(areaId, (entityCounts.get(areaId) ?? 0) + 1)
        }
    }
    return jsonResult(snapshot.areas.map((area) => ({
        area_id: area.area_id,
        name: area.name,
        floor_id: area.floor_id ?? null,
        aliases: area.aliases ?? [],
        entities: entityCounts.get(area.area_id) ?? 0,
    })))
}

/** `haos-tool devices [--search TEXT]` */
export async function devicesCommand(args: ParsedArgs, context: ToolContext): Promise<CommandResult> {
    const search = getStringOption(args, 'search') ?? args.positionals[0] ?? null
    const snapshot = await loadRegistry(context.client)
    const areaNames = areaNameMap(snapshot.areas)
    const rows = snapshot.devices.map((device) => ({
        id: device.id,
        name: deviceDisplayName(device),
        manufacturer: device.manufacturer,
        model: device.model,
        area: device.area_id === null ? null : areaNames.get(device.area_id) ?? device.area_id,
        disabled: Boolean(device.disabled_by),
        entities: snapshot.entities
            .filter((entry) => entry.device_id === device.id)
            .map((entry) => entry.entity_id),
    }))
    const filtered = search === null
        ? rows
        : rows.filter((row) => matchesSearch(search, [row.name, row.manufacturer, row.model, row.area, ...row.entities]))
    return jsonResult({ total: filtered.length, devices: filtered })
}

/** `haos-tool integrations` – configured integrations (config entries). */
export async function integrationsCommand(_args: ParsedArgs, context: ToolContext): Promise<CommandResult> {
    const entries = await context.client.core<unknown[]>('GET', '/api/config/config_entries/entry')
    const rows = entries.map((item) => {
        const entry = asRecord(item) ?? {}
        return {
            entry_id: asString(entry.entry_id),
            domain: asString(entry.domain),
            title: asString(entry.title),
            state: asString(entry.state),
            source: asString(entry.source),
            disabled_by: asString(entry.disabled_by),
        }
    })
    rows.sort((left, right) => (left.domain ?? '').localeCompare(right.domain ?? ''))
    return jsonResult({ total: rows.length, integrations: rows })
}
