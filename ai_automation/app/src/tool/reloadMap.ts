/**
 * Pure helpers for configuration check and reload.
 */
import {
    ToolError,
    asRecord,
    asString,
} from './cli.js'
import { RELOAD_DOMAIN_PATTERN } from './validation.js'

/** Service to call for a reload target. */
export interface ReloadService {
    domain: string
    service: string
}

/** Normalized result of `check_config`. */
export interface CheckConfigOutput {
    valid: boolean
    errors: string | null
    warnings: string | null
}

const SPECIAL_TARGETS: Readonly<Record<string, ReloadService>> = {
    core: { domain: 'homeassistant', service: 'reload_core_config' },
    all: { domain: 'homeassistant', service: 'reload_all' },
}

/**
 * Maps a reload target (automation, script, scene, group, template, input_*, core, all, ...)
 * to the HA service that reloads it.
 *
 * @throws {ToolError} when the target is not a valid domain name
 */
export function resolveReloadService(target: string): ReloadService {
    const special = SPECIAL_TARGETS[target]
    if (special !== undefined) {
        return special
    }
    if (!RELOAD_DOMAIN_PATTERN.test(target)) {
        throw new ToolError(`Invalid reload target "${target}" (e.g. automation, script, scene, template, input_boolean, core, all)`)
    }
    return { domain: target, service: 'reload' }
}

/** Normalizes the `/api/config/core/check_config` response. */
export function normalizeCheckResult(response: unknown): CheckConfigOutput {
    const record = asRecord(response) ?? {}
    return {
        valid: asString(record.result) === 'valid',
        errors: asString(record.errors),
        warnings: asString(record.warnings),
    }
}
