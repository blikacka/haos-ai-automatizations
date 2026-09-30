import type {
    ConfigCheckResult,
    RestoreResult,
} from '../../shared/api.js'
import type { ConfigGuard } from '../ha/configGuard.js'
import { logger } from '../util/logger.js'
import type { ConfigHistory } from './configHistory.js'

const RESTART_PREFIXES: readonly string[] = ['.storage/', 'custom_components/']

/** Minimal guard contract used by the restore service (allows fakes in tests). */
export type RestoreGuard = Pick<ConfigGuard, 'checkConfig' | 'reloadAll'>

/**
 * Decides whether changed paths need a Home Assistant restart to take effect.
 *
 * @param changedPaths paths relative to the config dir
 * @returns true for any .storage/ or custom_components/ change
 */
export function needsRestartFor(changedPaths: string[]): boolean {
    return changedPaths.some((path) => RESTART_PREFIXES.some((prefix) => path.startsWith(prefix)))
}

/** Restores a configuration version and guarantees Home Assistant is not left with an invalid configuration. */
export class RestoreService {
    private readonly history: ConfigHistory
    private readonly guard: RestoreGuard

    /**
     * @param history configuration history
     * @param guard configuration validator
     */
    public constructor(history: ConfigHistory, guard: RestoreGuard) {
        this.history = history
        this.guard = guard
    }

    /**
     * Restores the version, validates the configuration and reloads it; reverts when validation fails.
     *
     * @param versionId commit id
     * @param userName HA user performing the restore
     * @throws HistoryError on invalid or unknown version
     */
    public async restore(versionId: string, userName: string): Promise<RestoreResult> {
        await this.history.snapshot({ kind: 'manual', title: 'Změny provedené mimo AI (před obnovením)', userName })
        const previousVersion = await this.history.currentVersionId()
        const { version, changedPaths } = await this.history.restore(versionId, userName)
        if (version === null) {
            return { version: null, checkPassed: true, needsRestart: false, message: 'Konfigurace už odpovídá vybrané verzi.' }
        }
        const check = await this.safeCheck()
        if (!check.valid) {
            const rollback = await this.history.restore(previousVersion, userName)
            logger.warn('Restored version failed config check, reverted', { versionId, previousVersion })
            return {
                version: rollback.version,
                checkPassed: false,
                needsRestart: false,
                message: `Obnovená verze neprošla kontrolou konfigurace, změny byly vráceny. ${check.errors ?? ''}`.trim(),
            }
        }
        const needsRestart = needsRestartFor(changedPaths)
        const reloaded = await this.safeReload()
        return {
            version,
            checkPassed: true,
            needsRestart,
            message: this.successMessage(reloaded, needsRestart),
        }
    }

    private async safeCheck(): Promise<ConfigCheckResult> {
        try {
            return await this.guard.checkConfig()
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            logger.error('Config check failed to run after restore', { reason })
            return { valid: false, errors: `Kontrolu konfigurace se nepodařilo spustit: ${reason}` }
        }
    }

    private async safeReload(): Promise<boolean> {
        try {
            await this.guard.reloadAll()
            return true
        } catch (error) {
            logger.warn('Reload after restore failed', { reason: error instanceof Error ? error.message : String(error) })
            return false
        }
    }

    private successMessage(reloaded: boolean, needsRestart: boolean): string {
        const parts = ['Verze byla obnovena a konfigurace je platná.']
        parts.push(reloaded ? 'Konfigurace byla znovu načtena.' : 'Konfiguraci se nepodařilo znovu načíst.')
        if (needsRestart) {
            parts.push('Pro plné projevení změn je potřeba restartovat Home Assistant.')
        }
        return parts.join(' ')
    }
}
