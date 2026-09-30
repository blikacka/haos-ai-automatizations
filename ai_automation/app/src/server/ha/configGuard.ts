import type { ConfigCheckResult } from '../../shared/api.js'
import type { SupervisorClient } from './supervisorClient.js'

interface CheckConfigResponse {
    result?: string
    errors?: string | null
}

/** Validates, reloads and restarts Home Assistant Core safely. */
export class ConfigGuard {
    private readonly client: SupervisorClient

    /**
     * @param client supervisor / core API client
     */
    public constructor(client: SupervisorClient) {
        this.client = client
    }

    /**
     * Runs Home Assistant configuration check.
     *
     * @returns validity and error text
     * @throws SupervisorError when the check cannot be executed
     */
    public async checkConfig(): Promise<ConfigCheckResult> {
        const response = await this.client.core<CheckConfigResponse>('POST', '/api/config/core/check_config')
        const valid = response.result === 'valid'
        const errors = typeof response.errors === 'string' && response.errors.trim() !== '' ? response.errors : null
        return {
            valid,
            errors: valid ? errors : errors ?? 'Konfigurace není platná.',
        }
    }

    /**
     * Reloads all YAML configuration that supports reloading.
     *
     * @throws SupervisorError on failure
     */
    public async reloadAll(): Promise<void> {
        await this.client.core<unknown>('POST', '/api/services/homeassistant/reload_all', {})
    }

    /**
     * Restarts Home Assistant Core, but only when the configuration is valid.
     *
     * @throws Error when the configuration is invalid or the restart fails
     */
    public async restartCore(): Promise<void> {
        const check = await this.checkConfig()
        if (!check.valid) {
            throw new Error(`Restart odmítnut, konfigurace není platná: ${check.errors ?? ''}`)
        }
        await this.client.supervisor<unknown>('POST', '/core/restart')
    }
}
