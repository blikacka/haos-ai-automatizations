/**
 * Argument parsing and small helpers shared by all haos-tool commands.
 * Pure module (no I/O) so it can be unit tested.
 */

/** Result of parsing the raw argv of haos-tool. */
export interface ParsedArgs {
    command: string
    positionals: string[]
    options: Record<string, string | true>
}

/** Error with a user facing message and a process exit code. */
export class ToolError extends Error {
    readonly exitCode: number

    constructor(message: string, exitCode = 1) {
        super(message)
        this.name = 'ToolError'
        this.exitCode = exitCode
    }
}

/** Options that never take a value. */
const BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['help', 'return-response', 'full'])
const OPTION_NAME_PATTERN = /^[a-z][a-z0-9-]*$/

/**
 * Parses argv (without node and script path).
 * Supports `--name value`, `--name=value`, boolean flags and `--` terminator.
 *
 * @throws {ToolError} on malformed or duplicated options
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
    const positionals: string[] = []
    const options: Record<string, string | true> = {}
    let optionsEnded = false

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index] ?? ''
        if (optionsEnded || !token.startsWith('-') || token === '-') {
            positionals.push(token)
            continue
        }
        if (token === '--') {
            optionsEnded = true
            continue
        }
        if (token === '-h') {
            options.help = true
            continue
        }
        const body = token.replace(/^--?/, '')
        const equalsIndex = body.indexOf('=')
        const name = equalsIndex >= 0 ? body.slice(0, equalsIndex) : body
        if (!OPTION_NAME_PATTERN.test(name)) {
            throw new ToolError(`Invalid option: ${token}`)
        }
        if (Object.hasOwn(options, name)) {
            throw new ToolError(`Option --${name} given more than once`)
        }
        if (equalsIndex >= 0) {
            options[name] = body.slice(equalsIndex + 1)
        } else if (BOOLEAN_FLAGS.has(name)) {
            options[name] = true
        } else {
            const next = argv[index + 1]
            if (next === undefined || next.startsWith('--')) {
                throw new ToolError(`Option --${name} requires a value`)
            }
            options[name] = next
            index += 1
        }
    }

    const command = positionals.shift() ?? 'help'
    return { command, positionals, options }
}

/**
 * Returns a string option or null when absent.
 *
 * @throws {ToolError} when the option was given without a value
 */
export function getStringOption(args: ParsedArgs, name: string): string | null {
    const value = args.options[name]
    if (value === undefined) {
        return null
    }
    if (value === true || value.trim() === '') {
        throw new ToolError(`Option --${name} requires a value`)
    }
    return value
}

/** Returns true when a boolean flag is present. */
export function hasFlag(args: ParsedArgs, name: string): boolean {
    return args.options[name] === true
}

/**
 * Parses a bounded integer from text.
 *
 * @throws {ToolError} when the text is not an integer within bounds
 */
export function parseBoundedInt(text: string, label: string, min: number, max: number): number {
    if (!/^\d+$/.test(text)) {
        throw new ToolError(`${label} must be a positive integer`)
    }
    const value = Number.parseInt(text, 10)
    if (value < min || value > max) {
        throw new ToolError(`${label} must be between ${min} and ${max}`)
    }
    return value
}

/**
 * Returns an integer option or the fallback when absent.
 *
 * @throws {ToolError} when the value is not a valid integer within bounds
 */
export function getIntOption(args: ParsedArgs, name: string, fallback: number, min: number, max: number): number {
    const text = getStringOption(args, name)
    return text === null ? fallback : parseBoundedInt(text, `--${name}`, min, max)
}

/**
 * Returns the positional argument at index or throws a usage error.
 *
 * @throws {ToolError} when missing
 */
export function requirePositional(args: ParsedArgs, index: number, usage: string): string {
    const value = args.positionals[index]
    if (value === undefined || value.trim() === '') {
        throw new ToolError(`Missing argument. Usage: haos-tool ${usage}`)
    }
    return value
}

/**
 * Parses a JSON object argument (e.g. service data).
 *
 * @throws {ToolError} when not valid JSON or not a plain object
 */
export function parseJsonObject(text: string | undefined, label: string): Record<string, unknown> {
    if (text === undefined || text.trim() === '') {
        return {}
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new ToolError(`${label} is not valid JSON: ${reason}`)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ToolError(`${label} must be a JSON object`)
    }
    return parsed as Record<string, unknown>
}

/** Returns a plain object view of an unknown value or null. */
export function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

/** Returns the value when it is a string, otherwise null. */
export function asString(value: unknown): string | null {
    return typeof value === 'string' ? value : null
}
