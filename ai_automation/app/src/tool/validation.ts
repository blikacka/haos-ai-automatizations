/**
 * Input validation for haos-tool (prevents path/command injection into HA APIs).
 */
import { ToolError } from './cli.js'

export const ENTITY_ID_PATTERN = /^[a-z_]+\.[a-z0-9_]+$/
export const RELOAD_DOMAIN_PATTERN = /^[a-z_]+$/
export const SERVICE_PART_PATTERN = /^[a-z0-9_]+$/
export const ADDON_SLUG_PATTERN = /^[a-z0-9_-]{1,64}$/
export const AUTOMATION_ITEM_ID_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/
export const TRACE_RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const RAW_PATH_PATTERN = /^\/[A-Za-z0-9_\-./%?=&:,+@~]*$/

/** HTTP methods accepted by the raw REST commands. */
export type RawMethod = 'GET' | 'POST'

/** Parsed `domain.service` pair. */
export interface ServiceRef {
    domain: string
    service: string
}

/** Returns true for a syntactically valid entity id such as `light.kitchen`. */
export function isValidEntityId(value: string): boolean {
    return ENTITY_ID_PATTERN.test(value)
}

/**
 * Validates an entity id.
 *
 * @throws {ToolError} when invalid
 */
export function assertEntityId(value: string): string {
    if (!isValidEntityId(value)) {
        throw new ToolError(`Invalid entity id "${value}" (expected e.g. light.kitchen)`)
    }
    return value
}

/**
 * Validates a domain name (e.g. `light`).
 *
 * @throws {ToolError} when invalid
 */
export function assertDomain(value: string): string {
    if (!SERVICE_PART_PATTERN.test(value)) {
        throw new ToolError(`Invalid domain "${value}"`)
    }
    return value
}

/**
 * Parses and validates `domain.service`.
 *
 * @throws {ToolError} when invalid
 */
export function parseServiceRef(value: string): ServiceRef {
    const parts = value.split('.')
    const [domain, service] = parts
    if (parts.length !== 2 || domain === undefined || service === undefined
        || !SERVICE_PART_PATTERN.test(domain) || !SERVICE_PART_PATTERN.test(service)) {
        throw new ToolError(`Invalid service "${value}" (expected domain.service, e.g. light.turn_on)`)
    }
    return { domain, service }
}

/**
 * Validates an add-on slug.
 *
 * @throws {ToolError} when invalid
 */
export function assertAddonSlug(value: string): string {
    if (!ADDON_SLUG_PATTERN.test(value)) {
        throw new ToolError(`Invalid add-on slug "${value}"`)
    }
    return value
}

/**
 * Validates an HTTP method for raw REST calls.
 *
 * @throws {ToolError} when unsupported
 */
export function parseRawMethod(value: string): RawMethod {
    const upper = value.toUpperCase()
    if (upper !== 'GET' && upper !== 'POST') {
        throw new ToolError(`Unsupported method "${value}" (use GET or POST)`)
    }
    return upper
}

/**
 * Validates a raw API path: must start with '/', no traversal, no scheme/host, safe characters only.
 *
 * @throws {ToolError} when invalid
 */
export function assertApiPath(value: string): string {
    if (!RAW_PATH_PATTERN.test(value) || value.includes('..') || value.includes('//')) {
        throw new ToolError(`Invalid path "${value}" (must start with "/" and contain no ".." or "//")`)
    }
    return value
}
