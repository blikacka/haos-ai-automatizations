import type { GitRunner } from './gitRunner.js'

/** Number of paths passed to one `git rm` call (keeps argv well below OS limits). */
const BATCH_SIZE = 200

/**
 * Removes files from the git index that are tracked but now match the exclude list
 * (e.g. after the exclude list was extended). The files stay untouched on disk.
 *
 * @param git git runner of the history repository
 * @returns true when at least one file was untracked
 */
export async function untrackExcludedFiles(git: GitRunner): Promise<boolean> {
    const listed = await git.run(['ls-files', '-z', '--cached', '--ignored', '--exclude-standard'])
    const paths = listed.stdout.split('\0').filter((path) => path !== '')
    if (paths.length === 0) {
        return false
    }
    for (let start = 0; start < paths.length; start += BATCH_SIZE) {
        const batch = paths.slice(start, start + BATCH_SIZE).map((path) => `:(literal)${path}`)
        await git.run(['rm', '--cached', '--quiet', '--ignore-unmatch', '--', ...batch])
    }
    return true
}
