import type { IncomingMessage } from 'node:http'
import type { CurrentUser } from '../../shared/api.js'
import type { AppEnv } from '../config/env.js'

/** Address of the Home Assistant ingress proxy (Supervisor). */
export const INGRESS_PROXY_IP = '172.30.32.2'

/** Maximum accepted length of identity header values. */
export const MAX_IDENTITY_LENGTH = 128

const IPV4_MAPPED_PREFIX = '::ffff:'
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g

/** Development user used only when ALLOW_ANY_ORIGIN_IP is enabled and no identity headers are sent. */
export const DEV_USER: CurrentUser = {
    id: 'local-dev',
    name: 'dev',
    displayName: 'Vývojář',
}

type IdentityEnv = Pick<AppEnv, 'allowAnyOriginIp'>

/**
 * Normalize a socket remote address (strips the IPv4-mapped IPv6 prefix).
 */
export function normalizeIp(address: string | undefined): string {
    const value = (address ?? '').trim().toLowerCase()
    return value.startsWith(IPV4_MAPPED_PREFIX) ? value.slice(IPV4_MAPPED_PREFIX.length) : value
}

/**
 * Whether the request comes from the ingress proxy (or the check is disabled for development).
 */
export function isAllowedRemote(req: IncomingMessage, env: IdentityEnv): boolean {
    if (env.allowAnyOriginIp) {
        return true
    }
    return normalizeIp(req.socket.remoteAddress) === INGRESS_PROXY_IP
}

function headerValue(req: IncomingMessage, name: string): string {
    const raw = req.headers[name]
    const value = Array.isArray(raw) ? raw[0] : raw
    return decodeUtf8Header(value ?? '').replace(CONTROL_CHARACTERS, '').trim()
}

/**
 * HA ingress sends header values as raw UTF-8 bytes while Node decodes them as latin1.
 * Re-decode as UTF-8 when the bytes form valid UTF-8, otherwise keep the original value.
 */
function decodeUtf8Header(value: string): string {
    if (!/[\u0080-\u00ff]/.test(value)) {
        return value
    }
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(value, 'latin1'))
    } catch {
        return value
    }
}

function limitLength(value: string): string {
    return value.length > MAX_IDENTITY_LENGTH ? value.slice(0, MAX_IDENTITY_LENGTH) : value
}

/**
 * Resolve the Home Assistant user from ingress headers.
 * Returns null when the remote IP is not allowed or the user id header is missing / too long.
 */
export function resolveUser(req: IncomingMessage, env: IdentityEnv): CurrentUser | null {
    if (!isAllowedRemote(req, env)) {
        return null
    }
    const userId = headerValue(req, 'x-remote-user-id')
    if (userId === '') {
        return env.allowAnyOriginIp ? DEV_USER : null
    }
    if (userId.length > MAX_IDENTITY_LENGTH) {
        return null
    }
    const name = limitLength(headerValue(req, 'x-remote-user-name')) || userId
    const displayName = limitLength(headerValue(req, 'x-remote-user-display-name')) || name
    return { id: userId, name, displayName }
}
