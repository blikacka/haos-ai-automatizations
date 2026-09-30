/**
 * Service catalogue and service call handling of the mock HA.
 */
import { listAutomations, loadConfig } from './configCheck.mjs'

const ON_OFF_SERVICES = {
    turn_on: () => 'on',
    turn_off: () => 'off',
    toggle: (current) => (current === 'on' ? 'off' : 'on'),
}

const COVER_SERVICES = {
    open_cover: 'open',
    close_cover: 'closed',
}

const ENTITY_FIELD = { entity_id: { selector: { entity: {} } } }

/** Service definitions returned by GET /api/services and WS get_services. */
export const SERVICE_CATALOGUE = {
    homeassistant: {
        reload_all: { name: 'Reload all', description: 'Reload all YAML configuration that can be reloaded without restart.', fields: {} },
        reload_core_config: { name: 'Reload core configuration', description: 'Reloads the core configuration.', fields: {} },
        restart: { name: 'Restart', description: 'Restarts Home Assistant.', fields: {} },
        check_config: { name: 'Check configuration', description: 'Checks the configuration files.', fields: {} },
        turn_on: { name: 'Generic turn on', description: 'Generic action to turn devices on.', fields: {} },
        turn_off: { name: 'Generic turn off', description: 'Generic action to turn devices off.', fields: {} },
    },
    light: {
        turn_on: { name: 'Turn on', description: 'Turns on one or more lights.', fields: { brightness_pct: { selector: { number: { min: 0, max: 100 } } } } },
        turn_off: { name: 'Turn off', description: 'Turns off one or more lights.', fields: {} },
        toggle: { name: 'Toggle', description: 'Toggles one or more lights.', fields: {} },
    },
    switch: {
        turn_on: { name: 'Turn on', description: 'Turns a switch on.', fields: {} },
        turn_off: { name: 'Turn off', description: 'Turns a switch off.', fields: {} },
        toggle: { name: 'Toggle', description: 'Toggles a switch.', fields: {} },
    },
    cover: {
        open_cover: { name: 'Open', description: 'Opens a cover.', fields: {} },
        close_cover: { name: 'Close', description: 'Closes a cover.', fields: {} },
    },
    automation: {
        reload: { name: 'Reload', description: 'Reloads the automation configuration.', fields: {} },
        trigger: { name: 'Trigger', description: 'Triggers the actions of an automation.', fields: { skip_condition: { selector: { boolean: {} } } } },
        turn_on: { name: 'Turn on', description: 'Enables an automation.', fields: {} },
        turn_off: { name: 'Turn off', description: 'Disables an automation.', fields: {} },
    },
    script: {
        reload: { name: 'Reload', description: 'Reloads all the available scripts.', fields: {} },
        turn_on: { name: 'Turn on', description: 'Runs the sequence of actions defined in a script.', fields: {} },
    },
    scene: {
        reload: { name: 'Reload', description: 'Reloads the scenes from the YAML-configuration.', fields: {} },
        turn_on: { name: 'Activate', description: 'Activates a scene.', fields: {} },
    },
    notify: {
        persistent_notification: { name: 'Send a persistent notification', description: 'Sends a notification that is visible in the notifications panel.', fields: { message: { required: true, selector: { text: {} } } } },
    },
    persistent_notification: {
        create: { name: 'Create', description: 'Shows a notification on the notifications panel.', fields: { message: { required: true, selector: { text: {} } } } },
    },
}

for (const domainServices of Object.values(SERVICE_CATALOGUE)) {
    for (const service of Object.values(domainServices)) {
        service.fields = { ...ENTITY_FIELD, ...service.fields }
    }
}

/**
 * @param {Record<string, unknown>} data service data (entity_id may be string or list)
 * @param {Record<string, unknown> | undefined} target WS target
 * @returns {string[]} targeted entity ids
 */
function targetEntities(data, target) {
    const raw = target?.entity_id ?? data?.entity_id ?? []
    return [raw].flat().filter((value) => typeof value === 'string')
}

/**
 * @param {import('./homeState.mjs').MockHome} home mock HA
 * @param {string} entityId automation entity
 */
function triggerAutomation(home, entityId) {
    const automationId = home.states.get(entityId)?.attributes?.id
    const { config } = loadConfig(home.configDir)
    const automation = listAutomations(config).find((item) => String(item.id) === automationId)
    if (automation) {
        home.seedTrace(automation, true)
    }
    const current = home.states.get(entityId)
    if (current) {
        home.setState(entityId, current.state, { ...current.attributes, last_triggered: new Date().toISOString() })
    }
}

/**
 * Applies a service call to the mock state.
 *
 * @param {import('./homeState.mjs').MockHome} home mock HA
 * @param {string} domain service domain
 * @param {string} service service name
 * @param {Record<string, unknown>} data service data
 * @param {Record<string, unknown>} [target] WS target
 * @returns {{ ok: true } | { ok: false, error: string }} result
 */
export function callService(home, domain, service, data = {}, target = undefined) {
    if (!SERVICE_CATALOGUE[domain]?.[service]) {
        return { ok: false, error: `Service ${domain}.${service} not found.` }
    }
    const entityIds = targetEntities(data, target)
    home.serviceCalls.push({ domain, service, data, target: target ?? null, time: new Date().toISOString() })
    home.log(`INFO (MainThread) [homeassistant.core] Service call ${domain}.${service} ${JSON.stringify(data)}`)
    const reloadAll = domain === 'homeassistant' && service === 'reload_all'
    if ((domain === 'automation' && service === 'reload') || reloadAll) {
        home.reloadAutomations()
    }
    if ((domain === 'script' && service === 'reload') || reloadAll) {
        home.reloadScripts()
    }
    if (domain === 'homeassistant' && service === 'restart') {
        home.restartCore()
    }
    for (const entityId of entityIds) {
        applyEntityService(home, domain, service, entityId)
    }
    return { ok: true }
}

/**
 * @param {import('./homeState.mjs').MockHome} home mock HA
 * @param {string} domain service domain
 * @param {string} service service name
 * @param {string} entityId target entity
 */
function applyEntityService(home, domain, service, entityId) {
    const current = home.states.get(entityId)
    if (!current) {
        return
    }
    if (domain === 'automation' && service === 'trigger') {
        triggerAutomation(home, entityId)
        return
    }
    const onOff = ON_OFF_SERVICES[service]
    if (onOff && (entityId.startsWith(`${domain}.`) || domain === 'homeassistant')) {
        home.setState(entityId, onOff(current.state), current.attributes)
        return
    }
    if (domain === 'cover' && COVER_SERVICES[service]) {
        home.setState(entityId, COVER_SERVICES[service], current.attributes)
    }
}
