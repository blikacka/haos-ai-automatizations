/**
 * Case and diacritics insensitive search helpers (Czech names like "Světlo kotelna").
 */

/** Lowercases, trims and strips combining marks after NFD normalization. */
export function normalizeSearchText(value: string): string {
    return value
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
}

/**
 * Returns true when every whitespace separated word of the query occurs in at least one field.
 * Empty query matches everything.
 */
export function matchesSearch(query: string, fields: ReadonlyArray<string | null | undefined>): boolean {
    const words = normalizeSearchText(query).split(' ').filter((word) => word !== '')
    if (words.length === 0) {
        return true
    }
    const haystack = fields
        .filter((field): field is string => typeof field === 'string' && field !== '')
        .map(normalizeSearchText)
        .join('\n')
    return words.every((word) => haystack.includes(word))
}
