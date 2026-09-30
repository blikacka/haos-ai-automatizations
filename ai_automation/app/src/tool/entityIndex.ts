/**
 * Loads HA states + registries and joins them into compact entity rows.
 */
import type { SupervisorClient } from '../server/ha/supervisorClient.js'
import {
    matchesSearch,
    normalizeSearchText,
} from './search.js'

/** Entity state as returned by `get_states`. */
export interface HaState {
    entity_id: string
    state: string
    attributes: Record<string, unknown>
    last_changed?: string
    last_updated?: string
}

/** Entry of `config/entity_registry/list`. */
export interface EntityRegistryEntry {
    entity_id: string
    device_id: string | null
    area_id: string | null
    name: string | null
    original_name?: string | null
    platform: string
    disabled_by: string | null
    hidden_by?: string | null
    unique_id?: string
}

/** Entry of `config/device_registry/list`. */
export interface DeviceEntry {
    id: string
    name: string | null
    name_by_user: string | null
    area_id: string | null
    manufacturer: string | null
    model: string | null
    disabled_by?: string | null
}

/** Entry of `config/area_registry/list`. */
export interface AreaEntry {
    area_id: string
    name: string
    floor_id?: string | null
    aliases?: string[]
}

/** All registry data needed to describe entities. */
export interface RegistrySnapshot {
    states: HaState[]
    entities: EntityRegistryEntry[]
    devices: DeviceEntry[]
    areas: AreaEntry[]
}

/** Compact entity description printed by `haos-tool entities`. */
export interface EntityRow {
    entity_id: string
    name: string | null
    state: string
    area: string | null
    device: string | null
    domain: string
}

/** Filters of `haos-tool entities`. */
export interface EntityFilter {
    domain: string | null
    search: string | null
    area: string | null
}

/** Loads states and registries in parallel over the core websocket. */
export async function loadRegistry(client: SupervisorClient): Promise<RegistrySnapshot> {
    const [states, entities, devices, areas] = await Promise.all([
        client.coreWs<HaState[]>({ type: 'get_states' }),
        client.coreWs<EntityRegistryEntry[]>({ type: 'config/entity_registry/list' }),
        client.coreWs<DeviceEntry[]>({ type: 'config/device_registry/list' }),
        client.coreWs<AreaEntry[]>({ type: 'config/area_registry/list' }),
    ])
    return { states, entities, devices, areas }
}

/** Human readable device name (user override first). */
export function deviceDisplayName(device: DeviceEntry): string | null {
    return device.name_by_user ?? device.name
}

/** Maps area ids to names. */
export function areaNameMap(areas: readonly AreaEntry[]): Map<string, string> {
    return new Map(areas.map((area) => [area.area_id, area.name]))
}

/** Resolves the effective area id of an entity (own area, else its device's area). */
export function effectiveAreaId(entry: EntityRegistryEntry | undefined, device: DeviceEntry | undefined): string | null {
    return entry?.area_id ?? device?.area_id ?? null
}

/** Joins states with registries into compact rows sorted by entity id. */
export function buildEntityRows(snapshot: RegistrySnapshot): EntityRow[] {
    const entriesById = new Map(snapshot.entities.map((entry) => [entry.entity_id, entry]))
    const devicesById = new Map(snapshot.devices.map((device) => [device.id, device]))
    const areaNames = areaNameMap(snapshot.areas)

    return snapshot.states
        .map((state): EntityRow => {
            const entry = entriesById.get(state.entity_id)
            const device = entry?.device_id ? devicesById.get(entry.device_id) : undefined
            const areaId = effectiveAreaId(entry, device)
            const friendlyName = state.attributes.friendly_name
            return {
                entity_id: state.entity_id,
                name: typeof friendlyName === 'string' ? friendlyName : entry?.name ?? null,
                state: state.state,
                area: areaId === null ? null : areaNames.get(areaId) ?? areaId,
                device: device ? deviceDisplayName(device) : null,
                domain: state.entity_id.split('.')[0] ?? '',
            }
        })
        .sort((left, right) => left.entity_id.localeCompare(right.entity_id))
}

/** Returns true when the row's area matches the filter (area name contains text or equals area id). */
export function matchesArea(area: string | null, filterText: string, areas: readonly AreaEntry[]): boolean {
    if (area === null) {
        return false
    }
    const needle = normalizeSearchText(filterText)
    const areaEntry = areas.find((entry) => entry.name === area || entry.area_id === area)
    const candidates = [area, areaEntry?.area_id ?? '', ...(areaEntry?.aliases ?? [])]
    return candidates.some((candidate) => normalizeSearchText(candidate).includes(needle))
}

/** Applies domain, search and area filters. */
export function filterEntityRows(rows: readonly EntityRow[], filter: EntityFilter, areas: readonly AreaEntry[] = []): EntityRow[] {
    return rows.filter((row) => {
        if (filter.domain !== null && row.domain !== filter.domain) {
            return false
        }
        if (filter.area !== null && !matchesArea(row.area, filter.area, areas)) {
            return false
        }
        return filter.search === null || matchesSearch(filter.search, [row.entity_id, row.name, row.area, row.device])
    })
}
