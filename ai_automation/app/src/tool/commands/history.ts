/**
 * `snapshot` and `history` commands (config version history).
 */
import path from 'node:path'
import { ConfigHistory } from '../../server/history/configHistory.js'
import {
    parseBoundedInt,
    requirePositional,
    type ParsedArgs,
} from '../cli.js'
import {
    jsonResult,
    type CommandResult,
    type ToolContext,
} from '../types.js'

const DEFAULT_HISTORY_COUNT = 10
const MAX_HISTORY_COUNT = 100
const MAX_TITLE_LENGTH = 200

async function openHistory(context: ToolContext): Promise<ConfigHistory> {
    const history = new ConfigHistory(context.env.haConfigDir, path.join(context.env.dataDir, 'history.git'))
    await history.init()
    return history
}

/** `haos-tool snapshot "<message>"` – commits the current config state (kind before-ai). */
export async function snapshotCommand(args: ParsedArgs, context: ToolContext): Promise<CommandResult> {
    const message = requirePositional(args, 0, 'snapshot "<message>"')
        .replace(/[\r\n]+/g, ' ')
        .trim()
        .slice(0, MAX_TITLE_LENGTH)
    const history = await openHistory(context)
    const version = await history.snapshot({ kind: 'before-ai', title: message })
    return jsonResult(version === null
        ? { created: false, note: 'Nothing changed since the last version – current state is already saved.', currentVersion: await history.currentVersionId() }
        : { created: true, version })
}

/** `haos-tool history [N]` – newest versions first. */
export async function historyCommand(args: ParsedArgs, context: ToolContext): Promise<CommandResult> {
    const countText = args.positionals[0]
    const count = countText === undefined
        ? DEFAULT_HISTORY_COUNT
        : parseBoundedInt(countText, 'N', 1, MAX_HISTORY_COUNT)
    const history = await openHistory(context)
    const list = await history.list(count, null)
    return jsonResult(list.versions.map((version) => ({
        id: version.shortId,
        createdAt: version.createdAt,
        kind: version.kind,
        title: version.title,
        user: version.userName,
        filesChanged: version.filesChanged,
        current: version.isCurrent,
    })))
}
