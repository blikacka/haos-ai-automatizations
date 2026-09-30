import { HttpError } from './router.js'

/** Maximum length of short identifiers such as model or effort names. */
export const MAX_SHORT_TEXT = 64

/** Maximum length of chat titles. */
export const MAX_TITLE_LENGTH = 200

/**
 * Ensure the request body is a plain JSON object.
 *
 * @throws HttpError 400 otherwise
 */
export function requireObject(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new HttpError(400, 'Tělo požadavku musí být JSON objekt')
    }
    return value as Record<string, unknown>
}

/**
 * Read a required non-empty string (trimmed) with a maximum length.
 *
 * @throws HttpError 400 when missing, empty or too long
 */
export function requireString(source: Record<string, unknown>, key: string, maxLength: number): string {
    const value = source[key]
    if (typeof value !== 'string' || value.trim() === '') {
        throw new HttpError(400, `Pole ${key} je povinné`)
    }
    if (value.length > maxLength) {
        throw new HttpError(400, `Pole ${key} je příliš dlouhé (max ${maxLength} znaků)`)
    }
    return value.trim()
}

/**
 * Read an optional string that may be null or missing (both give null); empty strings give null.
 *
 * @throws HttpError 400 when of a wrong type or too long
 */
export function optionalString(source: Record<string, unknown>, key: string, maxLength: number): string | null {
    const value = source[key]
    if (value === undefined || value === null) {
        return null
    }
    if (typeof value !== 'string') {
        throw new HttpError(400, `Pole ${key} musí být text nebo null`)
    }
    if (value.length > maxLength) {
        throw new HttpError(400, `Pole ${key} je příliš dlouhé (max ${maxLength} znaků)`)
    }
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
}

/**
 * Parse an integer query parameter clamped into a range.
 *
 * @throws HttpError 400 when present but not an integer
 */
export function queryInteger(raw: string | null, fallback: number, min: number, max: number): number {
    if (raw === null || raw === '') {
        return fallback
    }
    if (!/^\d{1,6}$/.test(raw)) {
        throw new HttpError(400, 'Neplatné číslo v dotazu')
    }
    return Math.min(max, Math.max(min, Number(raw)))
}
