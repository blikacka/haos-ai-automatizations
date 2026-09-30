/**
 * Config entries (integrations) and a trivial config flow emulation.
 */
import { randomUUID } from 'node:crypto'

const DOMAIN_PATTERN = /^[a-z0-9_]{1,64}$/

/** Integrations whose config flow finishes immediately without user input. */
const INSTANT_FLOW_DOMAINS = {
    met: 'Domov',
    sun: 'Slunce',
    radio_browser: 'Radio Browser',
    workday: 'Pracovní dny',
}

/** Integrations whose config flow needs a form step first. */
const FORM_FLOW_DOMAINS = {
    modbus: [{ name: 'port', type: 'string', required: true }, { name: 'baudrate', type: 'integer', required: true }],
    mqtt: [{ name: 'broker', type: 'string', required: true }, { name: 'port', type: 'integer', required: true }],
}

/** Mutable list of config entries plus in-progress flows. */
export class ConfigEntries {
    constructor() {
        this.entries = ['shelly', 'zha', 'hue', 'sun', 'met'].map((domain) => this.newEntry(domain, domain.toUpperCase()))
        this.flows = new Map()
    }

    /**
     * @param {string} domain integration domain
     * @param {string} title entry title
     * @returns {Record<string, unknown>} config entry
     */
    newEntry(domain, title) {
        return {
            entry_id: `entry_${domain}`,
            domain,
            title,
            source: 'user',
            state: 'loaded',
            supports_options: false,
            supports_remove_device: false,
            supports_unload: true,
            pref_disable_new_entities: false,
            pref_disable_polling: false,
            disabled_by: null,
            reason: null,
        }
    }

    /**
     * @param {string} flowId flow id
     * @param {string} domain integration domain
     * @returns {Record<string, unknown>} create_entry flow result
     */
    finish(flowId, domain) {
        const title = INSTANT_FLOW_DOMAINS[domain] ?? domain
        const entry = { ...this.newEntry(domain, title), entry_id: randomUUID().replaceAll('-', '') }
        this.entries.push(entry)
        this.flows.delete(flowId)
        return { type: 'create_entry', flow_id: flowId, handler: domain, title, result: entry, description: null, description_placeholders: null }
    }

    /**
     * Starts a config flow (POST /api/config/config_entries/flow {handler}).
     *
     * @param {unknown} handler integration domain
     * @returns {{ status: number, body: Record<string, unknown> }} HTTP result
     */
    startFlow(handler) {
        if (typeof handler !== 'string' || !DOMAIN_PATTERN.test(handler)) {
            return { status: 400, body: { message: 'Invalid handler specified' } }
        }
        const flowId = randomUUID().replaceAll('-', '')
        if (INSTANT_FLOW_DOMAINS[handler]) {
            return { status: 200, body: this.finish(flowId, handler) }
        }
        if (FORM_FLOW_DOMAINS[handler]) {
            this.flows.set(flowId, handler)
            return {
                status: 200,
                body: { type: 'form', flow_id: flowId, handler, step_id: 'user', data_schema: FORM_FLOW_DOMAINS[handler], errors: {}, last_step: null },
            }
        }
        return { status: 404, body: { message: 'Invalid handler specified' } }
    }

    /**
     * Continues a flow (POST /api/config/config_entries/flow/<flow_id>).
     *
     * @param {string} flowId flow id
     * @param {Record<string, unknown>} userInput form data
     * @returns {{ status: number, body: Record<string, unknown> }} HTTP result
     */
    continueFlow(flowId, userInput) {
        const domain = this.flows.get(flowId)
        if (!domain) {
            return { status: 404, body: { message: 'Invalid flow specified' } }
        }
        const missing = FORM_FLOW_DOMAINS[domain].filter((field) => field.required && userInput[field.name] === undefined)
        if (missing.length > 0) {
            return { status: 200, body: { type: 'form', flow_id: flowId, handler: domain, step_id: 'user', errors: { base: 'missing_fields' } } }
        }
        return { status: 200, body: this.finish(flowId, domain) }
    }
}
