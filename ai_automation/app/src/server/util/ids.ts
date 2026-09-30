import {
    createHash,
    randomUUID,
} from 'node:crypto'

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const USER_DIR_NAME_LENGTH = 32

/**
 * Generates a new random identifier (32 lowercase hex chars).
 *
 * @returns identifier safe for file names and URLs
 */
export function newId(): string {
    return randomUUID().replaceAll('-', '')
}

/**
 * Checks that a value is safe to be used as a path segment / identifier.
 *
 * @param value candidate id
 * @returns true when it matches ^[A-Za-z0-9_-]{1,64}$
 */
export function isSafeId(value: string): boolean {
    return typeof value === 'string' && SAFE_ID_PATTERN.test(value)
}

/**
 * Maps an arbitrary HA user id to a stable directory name.
 *
 * @param userId HA user id
 * @returns first 32 hex chars of sha256(userId)
 */
export function userDirName(userId: string): string {
    return createHash('sha256').update(userId, 'utf8').digest('hex').slice(0, USER_DIR_NAME_LENGTH)
}
