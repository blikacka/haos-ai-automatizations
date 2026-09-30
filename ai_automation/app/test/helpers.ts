import {
    mkdir,
    mkdtemp,
} from 'node:fs/promises'
import {
    join,
    resolve,
} from 'node:path'
import { fileURLToPath } from 'node:url'

/** Project scratch directory (tests never use the system /tmp). */
export const scratchRoot: string = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'tmp')

/**
 * Creates a unique temporary directory inside the project scratch dir.
 *
 * @param prefix directory name prefix
 * @returns absolute path
 */
export async function makeTempDir(prefix: string): Promise<string> {
    await mkdir(scratchRoot, { recursive: true })
    return await mkdtemp(join(scratchRoot, `${prefix}-`))
}
