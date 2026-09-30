import {
    mkdir,
    readFile,
    rename,
    rm,
    writeFile,
} from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'

const FILE_MODE = 0o600
const DIR_MODE = 0o700

/**
 * Reads and parses a JSON file.
 *
 * @param path file path
 * @param fallback value returned when the file does not exist or is not valid JSON
 * @returns parsed content or fallback
 */
export async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
    let content: string
    try {
        content = await readFile(path, 'utf8')
    } catch {
        return fallback
    }
    try {
        return JSON.parse(content) as T
    } catch {
        return fallback
    }
}

/**
 * Writes JSON atomically (temporary file + rename), mode 0600, parent directories 0700.
 *
 * @param path target file path
 * @param data serializable data
 * @throws Error when writing fails
 */
export async function writeJsonFileAtomic(path: string, data: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: DIR_MODE })
    const tmpPath = `${path}.${randomBytes(6).toString('hex')}.tmp`
    try {
        await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, { mode: FILE_MODE })
        await rename(tmpPath, path)
    } catch (error) {
        await rm(tmpPath, { force: true })
        throw error
    }
}
