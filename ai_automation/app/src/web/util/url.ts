const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * Returns a normalized URL when it uses http(s), otherwise null (blocks javascript:, data:, ...).
 */
export function safeHttpUrl(raw: string): string | null {
    try {
        const url = new URL(raw, window.location.href)
        return ALLOWED_PROTOCOLS.has(url.protocol) ? url.toString() : null
    } catch {
        return null
    }
}
