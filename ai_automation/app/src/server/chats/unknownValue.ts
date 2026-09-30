/**
 * Narrows an unknown value to a plain object record.
 *
 * @param value any value received from the app-server
 * @returns record or null
 */
export function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

/**
 * Reads a string property of an unknown object.
 *
 * @param value object candidate
 * @param key property name
 * @returns string value or null
 */
export function readString(value: unknown, key: string): string | null {
    const property = asRecord(value)?.[key]
    return typeof property === 'string' ? property : null
}

/**
 * Reads a nested object property of an unknown object.
 *
 * @param value object candidate
 * @param key property name
 * @returns nested record or null
 */
export function readRecord(value: unknown, key: string): Record<string, unknown> | null {
    return asRecord(asRecord(value)?.[key])
}

/**
 * Converts an unknown thrown value to a message.
 *
 * @param error thrown value
 * @returns message text
 */
export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
