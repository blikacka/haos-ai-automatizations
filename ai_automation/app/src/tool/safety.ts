/**
 * Guard rails: haos-tool refuses operations that could take the whole system down.
 * Core restart is only possible through `haos-tool restart-core` (which validates config first).
 */
import {
    ToolError,
    asString,
} from './cli.js'
import type { RawMethod } from './validation.js'

/** Services that restart/stop HA or control host, supervisor and add-ons. */
const BLOCKED_SERVICES: ReadonlySet<string> = new Set([
    'homeassistant.restart',
    'homeassistant.stop',
])
const BLOCKED_SERVICE_DOMAINS: ReadonlySet<string> = new Set(['hassio'])

/** Mutating supervisor endpoints that must never be used by the agent. */
const BLOCKED_SUPERVISOR_PATTERNS: readonly RegExp[] = [
    /^\/host\//,
    /^\/os\//,
    /^\/supervisor\/(?!logs|info|stats|ping)/,
    /^\/core\/(?!logs|info|stats|check)/,
    /^\/addons\/[^/]+\/(uninstall|stop|restart|rebuild|update)/,
    /^\/addons\/[^/]+\/?$/,
    /^\/store\/addons\/[^/]+\/(install|update)/,
    /^\/backups\/[^/]+\/restore/,
    /^\/backups\/[^/]+\/?$/,
    /^\/auth/,
]

/**
 * Refuses dangerous service calls.
 *
 * @throws {ToolError} when the service is blocked
 */
export function assertServiceAllowed(domain: string, service: string): void {
    const fullName = `${domain}.${service}`
    if (BLOCKED_SERVICES.has(fullName)) {
        throw new ToolError(`${fullName} is blocked. Use "haos-tool restart-core" (it validates the configuration first).`)
    }
    if (BLOCKED_SERVICE_DOMAINS.has(domain)) {
        throw new ToolError(`Services of domain "${domain}" (host/supervisor/add-on control) are blocked.`)
    }
}

/**
 * Refuses dangerous raw core REST calls (service calls go through the service guard).
 *
 * @throws {ToolError} when blocked
 */
export function assertCoreRequestAllowed(method: RawMethod, path: string): void {
    if (method !== 'POST') {
        return
    }
    const match = /^\/api\/services\/([^/?]+)\/([^/?]+)/.exec(path)
    if (match !== null) {
        assertServiceAllowed(match[1] ?? '', match[2] ?? '')
    }
}

/**
 * Refuses mutating supervisor calls that restart/stop/update/uninstall anything.
 *
 * @throws {ToolError} when blocked
 */
export function assertSupervisorRequestAllowed(method: RawMethod, path: string): void {
    if (method !== 'POST') {
        return
    }
    const pathOnly = path.split('?')[0] ?? path
    if (BLOCKED_SUPERVISOR_PATTERNS.some((pattern) => pattern.test(pathOnly))) {
        throw new ToolError(`POST ${pathOnly} is blocked by haos-tool safety rules (never restart/stop/update host, supervisor or add-ons).`)
    }
}

/**
 * Refuses websocket messages that call blocked services or bypass the guard.
 *
 * @throws {ToolError} when blocked
 */
export function assertWsMessageAllowed(message: Record<string, unknown>): void {
    const type = asString(message.type)
    if (type === null || type === '') {
        throw new ToolError('Websocket message needs a string "type" field')
    }
    if (type === 'auth' || type.startsWith('auth/')) {
        throw new ToolError(`Websocket command "${type}" is blocked`)
    }
    if (type === 'call_service' || type === 'execute_script') {
        assertWsServiceCalls(type, message)
    }
    if (type === 'supervisor/api') {
        const method = (asString(message.method) ?? 'get').toUpperCase() === 'GET' ? 'GET' : 'POST'
        assertSupervisorRequestAllowed(method, asString(message.endpoint) ?? '')
    }
}

function assertWsServiceCalls(type: string, message: Record<string, unknown>): void {
    if (type === 'call_service') {
        assertServiceAllowed(asString(message.domain) ?? '', asString(message.service) ?? '')
        return
    }
    const serialized = JSON.stringify(message.sequence ?? null)
    if (/homeassistant\.(restart|stop)|hassio\./.test(serialized)) {
        throw new ToolError('execute_script with restart/stop/hassio actions is blocked')
    }
}
