import { readFileSync } from 'node:fs'
import {
    dirname,
    join,
    resolve,
} from 'node:path'
import { fileURLToPath } from 'node:url'

/** Runtime configuration of the add-on resolved from environment variables. */
export interface AppEnv {
    port: number
    haConfigDir: string
    dataDir: string
    supervisorUrl: string
    supervisorToken: string
    codexBin: string
    webDir: string
    agentDir: string
    allowAnyOriginIp: boolean
    addonVersion: string
}

/** Options configured by the user in the add-on configuration tab. */
export interface AddonOptions {
    defaultModel: string | null
    defaultEffort: string | null
    logLevel: 'debug' | 'info' | 'warning' | 'error'
}

type LogLevelOption = AddonOptions['logLevel']

const DEFAULT_PORT = 8099
const LOG_LEVELS: readonly LogLevelOption[] = ['debug', 'info', 'warning', 'error']
const FALLBACK_VERSION = '0.0.0'

/** Application root (directory containing package.json); this file lives in <root>/{src,dist}/server/config. */
export const appRoot: string = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function readString(name: string, fallback: string): string {
    const value = process.env[name]
    return value !== undefined && value.trim() !== '' ? value.trim() : fallback
}

function readPort(): number {
    const parsed = Number.parseInt(readString('PORT', String(DEFAULT_PORT)), 10)
    return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_PORT
}

function readAddonVersion(): string {
    const fromEnv = process.env.ADDON_VERSION
    if (fromEnv !== undefined && fromEnv.trim() !== '') {
        return fromEnv.trim()
    }
    try {
        const packageJson: unknown = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
        if (typeof packageJson === 'object' && packageJson !== null && 'version' in packageJson) {
            const version = (packageJson as { version: unknown }).version
            return typeof version === 'string' ? version : FALLBACK_VERSION
        }
    } catch {
        // package.json missing or unreadable – fall back to a neutral version
    }
    return FALLBACK_VERSION
}

/**
 * Loads the application environment with local-development overrides.
 *
 * @returns resolved environment
 */
export function loadEnv(): AppEnv {
    return {
        port: readPort(),
        haConfigDir: resolve(readString('HA_CONFIG_DIR', '/homeassistant')),
        dataDir: resolve(readString('DATA_DIR', '/data')),
        supervisorUrl: readString('SUPERVISOR_URL', 'http://supervisor').replace(/\/+$/, ''),
        supervisorToken: process.env.SUPERVISOR_TOKEN ?? '',
        codexBin: readString('CODEX_BIN', 'codex'),
        webDir: resolve(readString('WEB_DIR', join(appRoot, 'dist', 'web'))),
        agentDir: resolve(readString('AGENT_DIR', join(appRoot, 'agent'))),
        allowAnyOriginIp: process.env.ALLOW_ANY_ORIGIN_IP === '1',
        addonVersion: readAddonVersion(),
    }
}

function optionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function toLogLevel(value: unknown): LogLevelOption {
    return LOG_LEVELS.find((level) => level === value) ?? 'info'
}

/**
 * Reads add-on options from `<dataDir>/options.json`; missing or invalid values fall back to defaults.
 *
 * @param dataDir persistent add-on data directory
 * @returns parsed options
 */
export function loadAddonOptions(dataDir: string): AddonOptions {
    let raw: Record<string, unknown> = {}
    try {
        const parsed: unknown = JSON.parse(readFileSync(join(dataDir, 'options.json'), 'utf8'))
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            raw = parsed as Record<string, unknown>
        }
    } catch {
        // options.json missing (local dev) or malformed – defaults apply
    }
    return {
        defaultModel: optionalString(raw.default_model),
        defaultEffort: optionalString(raw.default_reasoning),
        logLevel: toLogLevel(raw.log_level),
    }
}
