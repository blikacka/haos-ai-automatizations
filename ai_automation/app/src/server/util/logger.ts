/** Supported log levels ordered by severity. */
export type LogLevel = 'debug' | 'info' | 'warning' | 'error'

/** Log method signature. */
export type LogMethod = (msg: string, meta?: Record<string, unknown>) => void

const LEVEL_WEIGHT: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warning: 30,
    error: 40,
}

const SECRET_KEY_PATTERN = /token|secret|password|authorization|api_?key/i
const REDACTED = '[redacted]'

let currentLevel: LogLevel = 'info'

/**
 * Sets the minimal level that will be written.
 *
 * @param level new minimal level ('warn' is accepted as alias of 'warning')
 */
export function setLogLevel(level: LogLevel | 'warn'): void {
    currentLevel = level === 'warn' ? 'warning' : level
}

function sanitizeMeta(meta: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(meta)) {
        if (SECRET_KEY_PATTERN.test(key)) {
            result[key] = REDACTED
        } else if (value instanceof Error) {
            result[key] = value.message
        } else {
            result[key] = value
        }
    }
    return result
}

function formatMeta(meta: Record<string, unknown> | undefined): string {
    if (meta === undefined || Object.keys(meta).length === 0) {
        return ''
    }
    try {
        return ` ${JSON.stringify(sanitizeMeta(meta))}`
    } catch {
        return ' [unserializable meta]'
    }
}

function write(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[currentLevel]) {
        return
    }
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${msg}${formatMeta(meta)}\n`
    if (level === 'error' || level === 'warning') {
        process.stderr.write(line)
    } else {
        process.stdout.write(line)
    }
}

/** Application logger; keys looking like secrets are redacted from meta. */
export const logger: { debug: LogMethod, info: LogMethod, warn: LogMethod, error: LogMethod } = {
    debug: (msg, meta) => write('debug', msg, meta),
    info: (msg, meta) => write('info', msg, meta),
    warn: (msg, meta) => write('warning', msg, meta),
    error: (msg, meta) => write('error', msg, meta),
}
