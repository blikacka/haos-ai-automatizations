import { join } from 'node:path'
import type {
    AccountState,
    MeResponse,
    ModelOption,
    UserSettings,
} from '../../../shared/api.js'
import {
    type AppEnv,
    loadAddonOptions,
} from '../../config/env.js'
import { userDirName } from '../../util/ids.js'
import {
    readJsonFile,
    writeJsonFileAtomic,
} from '../../util/jsonFile.js'
import { logger } from '../../util/logger.js'
import type { Router } from '../router.js'
import {
    MAX_SHORT_TEXT,
    optionalString,
    requireObject,
} from '../validation.js'

/** Dependencies of the me / models / settings routes. */
export interface MeRouteDeps {
    env: AppEnv
    accounts: { getAccount(userId: string): Promise<AccountState> }
    models: { listModels(userId: string): Promise<ModelOption[]> }
}

function settingsPath(env: AppEnv, userId: string): string {
    return join(env.dataDir, 'users', userDirName(userId), 'settings.json')
}

function defaultSettings(env: AppEnv): UserSettings {
    const options = loadAddonOptions(env.dataDir)
    return { model: options.defaultModel, effort: options.defaultEffort }
}

/**
 * Load the stored settings of a user, falling back to add-on option defaults.
 */
export async function loadUserSettings(env: AppEnv, userId: string): Promise<UserSettings> {
    const defaults = defaultSettings(env)
    const stored = await readJsonFile<unknown>(settingsPath(env, userId), null)
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
        return defaults
    }
    const record = stored as Record<string, unknown>
    return {
        model: typeof record.model === 'string' ? record.model : defaults.model,
        effort: typeof record.effort === 'string' ? record.effort : defaults.effort,
    }
}

async function accountOrLoggedOut(deps: MeRouteDeps, userId: string): Promise<AccountState> {
    try {
        return await deps.accounts.getAccount(userId)
    } catch (error) {
        logger.warn('Reading Codex account failed, reporting logged out', {
            error: error instanceof Error ? error.message : String(error),
        })
        return { status: 'loggedOut' }
    }
}

/**
 * Register GET /api/me, GET /api/models and PUT /api/settings.
 */
export function register(router: Router, deps: MeRouteDeps): void {
    router.add('GET', '/api/me', async ({ user }): Promise<MeResponse> => ({
        user,
        account: await accountOrLoggedOut(deps, user.id),
        settings: await loadUserSettings(deps.env, user.id),
        addonVersion: deps.env.addonVersion,
    }))

    router.add('GET', '/api/models', async ({ user }) => deps.models.listModels(user.id))

    router.add('PUT', '/api/settings', async ({ user, body }): Promise<UserSettings> => {
        const input = requireObject(body)
        const settings: UserSettings = {
            model: optionalString(input, 'model', MAX_SHORT_TEXT),
            effort: optionalString(input, 'effort', MAX_SHORT_TEXT),
        }
        await writeJsonFileAtomic(settingsPath(deps.env, user.id), settings)
        return settings
    })
}
