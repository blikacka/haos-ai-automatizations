/**
 * Builds HA registry payloads (area, device, entity) from the seed data.
 */
import {
    AREAS,
    DEVICES,
    ENTITIES,
} from './seedData.mjs'

const SEED_TIMESTAMP = 1727712000

/**
 * @returns {Record<string, unknown>[]} config/area_registry/list result
 */
export function buildAreaRegistry() {
    return AREAS.map((area) => ({
        area_id: area.areaId,
        name: area.name,
        icon: area.icon,
        floor_id: null,
        aliases: [],
        labels: [],
        picture: null,
        humidity_entity_id: null,
        temperature_entity_id: null,
        created_at: SEED_TIMESTAMP,
        modified_at: SEED_TIMESTAMP,
    }))
}

/**
 * @returns {Record<string, unknown>[]} config/device_registry/list result
 */
export function buildDeviceRegistry() {
    return DEVICES.map((device) => ({
        id: device.deviceId,
        name: device.name,
        name_by_user: null,
        manufacturer: device.manufacturer,
        model: device.model,
        model_id: null,
        area_id: device.areaId,
        config_entries: [`entry_${device.integration}`],
        primary_config_entry: `entry_${device.integration}`,
        connections: [],
        identifiers: [[device.integration, device.deviceId]],
        via_device_id: null,
        sw_version: '1.0.0',
        hw_version: null,
        serial_number: null,
        entry_type: null,
        disabled_by: null,
        configuration_url: null,
        labels: [],
        created_at: SEED_TIMESTAMP,
        modified_at: SEED_TIMESTAMP,
    }))
}

/**
 * @param {string} entityId entity id
 * @returns {string} integration platform
 */
function platformFor(entityId) {
    const deviceId = ENTITIES.find((entity) => entity.entityId === entityId)?.deviceId
    return DEVICES.find((device) => device.deviceId === deviceId)?.integration ?? entityId.split('.')[0]
}

/**
 * @param {{ entityId: string, name: string, deviceId?: string | null, areaId?: string }[]} extraEntities
 *     dynamic entities (automations, scripts) to include
 * @returns {Record<string, unknown>[]} config/entity_registry/list result
 */
export function buildEntityRegistry(extraEntities = []) {
    return [...ENTITIES, ...extraEntities].map((entity) => ({
        entity_id: entity.entityId,
        id: `reg_${entity.entityId.replace('.', '_')}`,
        unique_id: entity.uniqueId ?? entity.entityId,
        platform: entity.platform ?? platformFor(entity.entityId),
        device_id: entity.deviceId ?? null,
        area_id: entity.areaId ?? null,
        config_entry_id: entity.deviceId ? `entry_${platformFor(entity.entityId)}` : null,
        name: null,
        original_name: entity.name,
        icon: null,
        disabled_by: null,
        hidden_by: null,
        entity_category: null,
        has_entity_name: false,
        labels: [],
        categories: {},
        options: {},
        translation_key: null,
        created_at: SEED_TIMESTAMP,
        modified_at: SEED_TIMESTAMP,
    }))
}

/**
 * @param {Record<string, unknown>[]} registry full entity registry
 * @returns {Record<string, unknown>} config/entity_registry/list_for_display result
 */
export function buildEntityRegistryForDisplay(registry) {
    return {
        entity_categories: { 0: 'config', 1: 'diagnostic' },
        entities: registry.map((entry) => {
            const compact = { ei: entry.entity_id, pl: entry.platform }
            if (entry.device_id) {
                compact.di = entry.device_id
            }
            if (entry.area_id) {
                compact.ai = entry.area_id
            }
            if (entry.original_name) {
                compact.en = entry.original_name
            }
            return compact
        }),
    }
}
