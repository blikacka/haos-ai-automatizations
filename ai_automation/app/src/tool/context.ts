/**
 * Builds the runtime context (env + API clients) of haos-tool.
 */
import { loadEnv } from '../server/config/env.js'
import { SupervisorClient } from '../server/ha/supervisorClient.js'
import { ToolError } from './cli.js'
import { RawHttp } from './rawHttp.js'
import type { ToolContext } from './types.js'

/**
 * Creates the tool context from the environment.
 *
 * @throws {ToolError} when SUPERVISOR_TOKEN is missing
 */
export function createToolContext(): ToolContext {
    const env = loadEnv()
    if (env.supervisorToken === '') {
        throw new ToolError('SUPERVISOR_TOKEN is not set (haos-tool must run inside the add-on container)')
    }
    return {
        env,
        client: new SupervisorClient(env.supervisorUrl, env.supervisorToken),
        http: new RawHttp(env.supervisorUrl, env.supervisorToken),
    }
}
