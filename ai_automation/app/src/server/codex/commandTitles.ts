import {
    isAbsolute,
    normalize,
    relative,
} from 'node:path'
import type { ActivityKind } from '../../shared/api.js'

/** Loosely typed JSON object. */
export type Rec = Record<string, unknown>

/** Maximal length of short previews in titles. */
export const PREVIEW_LENGTH = 80

/** Friendly Czech titles of haos-tool sub-commands. */
const HAOS_TOOL_TITLES: Readonly<Record<string, string>> = {
    'help': 'Čtu nápovědu nástroje',
    'entities': 'Zjišťuji entity',
    'entity': 'Zjišťuji entity',
    'areas': 'Zjišťuji oblasti',
    'devices': 'Zjišťuji zařízení',
    'integrations': 'Zjišťuji integrace',
    'services': 'Zjišťuji služby',
    'call': 'Volám službu',
    'check-config': 'Kontroluji konfiguraci',
    'reload': 'Načítám konfiguraci znovu',
    'restart-core': 'Restartuji Home Assistant',
    'hardware': 'Zjišťuji hardware',
    'usb': 'Zjišťuji hardware',
    'logs': 'Čtu logy',
    'snapshot': 'Vytvářím zálohu',
    'backup': 'Vytvářím zálohu',
    'history': 'Čtu historii verzí',
    'addons': 'Zjišťuji doplňky',
    'addon': 'Zjišťuji doplňky',
    'ws': 'Volám API Home Assistantu',
    'api': 'Volám API Home Assistantu',
    'supervisor': 'Volám API Supervisoru',
    'automation-trace': 'Čtu průběh automatizace',
}

const SHELL_WRAPPER = /^(?:\S*\/)?(?:ba|z|da)?sh\s+-l?c\s+(['"])([\s\S]*)\1\s*$/
const HAOS_TOOL_CALL = /(?:^|[\s;&|(])(?:\S*\/)?haos-tool\s+([a-z][a-z_-]*)/
const HAOS_TOOL_SERVICE = /haos-tool\s+call\s+([a-z0-9_]+\.[a-z0-9_]+)/

/**
 * Returns the value when it is a plain object.
 *
 * @param value anything
 * @returns object or null
 */
export function asRec(value: unknown): Rec | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Rec : null
}

/**
 * Reads a string property.
 *
 * @param record object or null
 * @param key property name
 * @returns string value or null
 */
export function str(record: Rec | null, key: string): string | null {
    const value = record?.[key]
    return typeof value === 'string' ? value : null
}

/**
 * Shortens a text with an ellipsis.
 *
 * @param text text
 * @param maxLength maximal length
 * @returns shortened text
 */
export function truncate(text: string, maxLength: number): string {
    return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`
}

/**
 * Makes a path relative to the HA config dir when it lies inside it.
 *
 * @param path absolute or relative path
 * @param haConfigDir HA config dir
 * @returns relative path (or the original path outside the config dir)
 */
export function toRelativePath(path: string, haConfigDir: string): string {
    if (!isAbsolute(path)) {
        return normalize(path)
    }
    const relativePath = relative(haConfigDir, path)
    if (relativePath === '') {
        return '.'
    }
    return relativePath.startsWith('..') || isAbsolute(relativePath) ? path : relativePath
}

/**
 * Removes a `bash -lc '...'` wrapper from a command.
 *
 * @param command command string
 * @returns inner command
 */
export function unwrapShellCommand(command: string): string {
    const match = SHELL_WRAPPER.exec(command.trim())
    return match?.[2] !== undefined ? match[2].trim() : command.trim()
}

function haosToolTitle(command: string): string | null {
    const subCommand = HAOS_TOOL_CALL.exec(command)?.[1]
    if (subCommand === undefined) {
        return null
    }
    const title = Object.hasOwn(HAOS_TOOL_TITLES, subCommand)
        ? HAOS_TOOL_TITLES[subCommand] ?? subCommand
        : `Spouštím haos-tool ${subCommand}`
    const service = subCommand === 'call' ? HAOS_TOOL_SERVICE.exec(command)?.[1] : undefined
    return service === undefined ? title : `${title} ${service}`
}

function actionTitle(actions: Rec[], haConfigDir: string): { kind: ActivityKind, title: string } | null {
    const types = new Set(actions.map((action) => str(action, 'type')))
    if (types.size !== 1) {
        return null
    }
    const first = actions[0] ?? null
    if (types.has('read')) {
        const names = actions.map((action) => str(action, 'name') ?? str(action, 'path') ?? '').filter((name) => name !== '')
        return names.length === 0 ? null : { kind: 'read', title: `Čtu soubor ${truncate(names.join(', '), PREVIEW_LENGTH)}` }
    }
    if (types.has('listFiles')) {
        const path = str(first, 'path')
        return { kind: 'read', title: `Procházím složku ${path === null ? '.' : toRelativePath(path, haConfigDir)}` }
    }
    if (types.has('search')) {
        const query = str(first, 'query')
        return { kind: 'search', title: query === null ? 'Hledám v souborech' : `Hledám „${truncate(query, PREVIEW_LENGTH)}“` }
    }
    return null
}

/**
 * Builds a human friendly Czech title of a command execution.
 *
 * @param command unwrapped command
 * @param actions parsed command actions
 * @param haConfigDir HA config dir
 * @returns activity kind and title
 */
export function describeCommand(command: string, actions: Rec[], haConfigDir: string): { kind: ActivityKind, title: string } {
    const toolTitle = haosToolTitle(command)
    if (toolTitle !== null) {
        return { kind: 'command', title: toolTitle }
    }
    return actionTitle(actions, haConfigDir)
        ?? { kind: 'command', title: `Spouštím příkaz: ${truncate(command.replace(/\s+/g, ' '), PREVIEW_LENGTH)}` }
}
