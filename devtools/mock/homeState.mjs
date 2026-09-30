/**
 * In-memory state of the mock Home Assistant (states, registries, logs, traces, restarts).
 */
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import {
    listAutomations,
    listScripts,
    loadConfig,
} from './configCheck.mjs'
import {
    buildAreaRegistry,
    buildDeviceRegistry,
    buildEntityRegistry,
} from './registries.mjs'
import {
    ENTITIES,
    SEED_LOG_LINES,
} from './seedData.mjs'

const RESTART_DURATION_MS = 2000
const MAX_LOG_LINES = 2000
const MAX_TRACES_PER_AUTOMATION = 5

/**
 * Converts a (Czech) name into an HA object id, e.g. "Rozsvítit chodbu" -> "rozsvitit_chodbu".
 *
 * @param {string} text any text
 * @returns {string} slug
 */
export function slugify(text) {
    return String(text)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'unnamed'
}

/**
 * @returns {{ id: string, parent_id: null, user_id: null }} HA context object
 */
export function newContext() {
    return { id: randomUUID().replaceAll('-', '').toUpperCase().slice(0, 26), parent_id: null, user_id: null }
}

/** Mutable mock HA instance. Emits 'state_changed' ({ entity_id, old_state, new_state }) and 'restart'. */
export class MockHome extends EventEmitter {
    /**
     * @param {string} configDir HA config directory
     */
    constructor(configDir) {
        super()
        this.configDir = configDir
        this.states = new Map()
        this.dynamicEntities = []
        this.serviceCalls = []
        this.logLines = []
        this.traces = new Map()
        this.backups = []
        this.restartingUntil = 0
        for (const line of SEED_LOG_LINES) {
            this.log(line)
        }
        for (const entity of ENTITIES) {
            this.setState(entity.entityId, entity.state, { friendly_name: entity.name, ...entity.attributes })
        }
        this.reloadAutomations()
        this.reloadScripts()
    }

    /** @returns {boolean} true while the simulated core restart is in progress */
    isCoreDown() {
        return Date.now() < this.restartingUntil
    }

    /**
     * @param {string} line log line without timestamp
     */
    log(line) {
        const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 23)
        this.logLines.push(`${timestamp} ${line}`)
        if (this.logLines.length > MAX_LOG_LINES) {
            this.logLines.splice(0, this.logLines.length - MAX_LOG_LINES)
        }
    }

    /**
     * @param {string} entityId entity id
     * @param {string} state new state
     * @param {Record<string, unknown>} attributes full attribute set
     * @returns {Record<string, unknown>} new state object
     */
    setState(entityId, state, attributes) {
        const oldState = this.states.get(entityId) ?? null
        const now = new Date().toISOString()
        const changed = oldState === null || oldState.state !== state
        const newState = {
            entity_id: entityId,
            state: String(state),
            attributes,
            last_changed: changed ? now : oldState.last_changed,
            last_reported: now,
            last_updated: now,
            context: newContext(),
        }
        this.states.set(entityId, newState)
        this.emit('state_changed', { entity_id: entityId, old_state: oldState, new_state: newState })
        return newState
    }

    /**
     * @param {string} prefix entity id prefix like "automation."
     */
    removeStatesWithPrefix(prefix) {
        for (const entityId of [...this.states.keys()]) {
            if (entityId.startsWith(prefix)) {
                this.states.delete(entityId)
            }
        }
        this.dynamicEntities = this.dynamicEntities.filter((entity) => !entity.entityId.startsWith(prefix))
    }

    /** Re-reads automations from the config dir and rebuilds automation.* states. */
    reloadAutomations() {
        const { config, errors } = loadConfig(this.configDir)
        errors.forEach((error) => this.log(`ERROR (MainThread) [homeassistant.components.automation] ${error}`))
        this.removeStatesWithPrefix('automation.')
        const usedIds = new Set()
        for (const automation of listAutomations(config)) {
            const baseId = `automation.${slugify(automation.alias ?? automation.id ?? 'automation')}`
            let entityId = baseId
            for (let suffix = 2; usedIds.has(entityId); suffix += 1) {
                entityId = `${baseId}_${suffix}`
            }
            usedIds.add(entityId)
            const hasTriggers = (automation.triggers ?? automation.trigger) !== undefined
            const hasActions = (automation.actions ?? automation.action) !== undefined
            const valid = hasTriggers && hasActions
            this.setState(entityId, valid ? (automation.initial_state === false ? 'off' : 'on') : 'unavailable', {
                id: automation.id === undefined ? undefined : String(automation.id),
                last_triggered: null,
                mode: automation.mode ?? 'single',
                current: 0,
                friendly_name: automation.alias ?? entityId,
            })
            this.dynamicEntities.push({
                entityId,
                name: automation.alias ?? entityId,
                platform: 'automation',
                uniqueId: automation.id === undefined ? entityId : String(automation.id),
            })
            this.seedTrace(automation)
        }
        this.log(`INFO (MainThread) [homeassistant.components.automation] Loaded ${usedIds.size} automations`)
    }

    /** Re-reads scripts and rebuilds script.* states. */
    reloadScripts() {
        const { config } = loadConfig(this.configDir)
        this.removeStatesWithPrefix('script.')
        for (const [scriptId, script] of Object.entries(listScripts(config))) {
            const entityId = `script.${slugify(scriptId)}`
            const friendlyName = script?.alias ?? scriptId
            this.setState(entityId, 'off', { last_triggered: null, mode: script?.mode ?? 'single', current: 0, friendly_name: friendlyName })
            this.dynamicEntities.push({ entityId, name: friendlyName, platform: 'script', uniqueId: scriptId })
        }
    }

    /**
     * Records a trace for an automation (used on reload and automation.trigger).
     *
     * @param {Record<string, unknown>} automation automation config
     * @param {boolean} force add a new trace even if some exist
     */
    seedTrace(automation, force = false) {
        if (automation.id === undefined) {
            return
        }
        const itemId = String(automation.id)
        const existing = this.traces.get(itemId) ?? []
        if (existing.length > 0 && !force) {
            return
        }
        const firstTrigger = [automation.triggers ?? automation.trigger].flat()[0] ?? {}
        const start = new Date(Date.now() - 60000)
        existing.unshift({
            run_id: randomUUID().replaceAll('-', ''),
            domain: 'automation',
            item_id: itemId,
            last_step: 'action/0',
            state: 'stopped',
            script_execution: 'finished',
            timestamp: { start: start.toISOString(), finish: new Date(start.getTime() + 120).toISOString() },
            trigger: `state of ${firstTrigger.entity_id ?? 'unknown'}`,
            context: newContext(),
            config: automation,
        })
        this.traces.set(itemId, existing.slice(0, MAX_TRACES_PER_AUTOMATION))
    }

    /** @returns {Record<string, unknown>[]} entity registry including automations/scripts */
    entityRegistry() {
        return buildEntityRegistry(this.dynamicEntities)
    }

    /** @returns {Record<string, unknown>[]} device registry */
    deviceRegistry() {
        return buildDeviceRegistry()
    }

    /** @returns {Record<string, unknown>[]} area registry */
    areaRegistry() {
        return buildAreaRegistry()
    }

    /** Simulates `ha core restart`: core is unavailable for 2 s, then everything is reloaded. */
    restartCore() {
        this.restartingUntil = Date.now() + RESTART_DURATION_MS
        this.log('INFO (MainThread) [homeassistant.core] Stopping Home Assistant (restart requested)')
        this.emit('restart')
        setTimeout(() => {
            this.reloadAutomations()
            this.reloadScripts()
            this.log('INFO (MainThread) [homeassistant.core] Home Assistant started after restart')
        }, RESTART_DURATION_MS)
    }
}
