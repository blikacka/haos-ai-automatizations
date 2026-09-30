import type { ConfigCheckResult } from '../../../shared/api.js'
import { logger } from '../../util/logger.js'
import {
    HttpError,
    type Router,
} from '../router.js'

/** Subset of ConfigGuard used by the system routes. */
export interface SystemGuardPort {
    checkConfig(): Promise<ConfigCheckResult>
    restartCore(): Promise<void>
}

/** Dependencies of the system routes. */
export interface SystemRouteDeps {
    guard: SystemGuardPort
}

/**
 * Register configuration check and Home Assistant Core restart routes.
 */
export function register(router: Router, deps: SystemRouteDeps): void {
    router.add('POST', '/api/system/check-config', async () => deps.guard.checkConfig())
    router.add('POST', '/api/system/restart', async ({ user }) => {
        try {
            await deps.guard.restartCore()
        } catch (error) {
            logger.warn('Core restart refused or failed', {
                error: error instanceof Error ? error.message : String(error),
            })
            throw new HttpError(409, 'Restart nebyl proveden – konfigurace neprošla kontrolou nebo restart selhal')
        }
        logger.info('Home Assistant Core restart requested', { user: user.name })
        return { ok: true }
    })
}
