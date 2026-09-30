import assert from 'node:assert/strict'
import {
    readFile,
    rm,
    writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import {
    after,
    beforeEach,
    describe,
    it,
} from 'node:test'
import type { ConfigCheckResult } from '../src/shared/api.ts'
import { ConfigHistory } from '../dist/server/history/configHistory.js'
import {
    RestoreService,
    needsRestartFor,
} from '../dist/server/history/restoreService.js'
import { makeTempDir } from './helpers.ts'

class FakeGuard {
    public valid = true
    public reloads = 0

    public async checkConfig(): Promise<ConfigCheckResult> {
        return { valid: this.valid, errors: this.valid ? null : 'Invalid config for [automation]' }
    }

    public async reloadAll(): Promise<void> {
        this.reloads += 1
    }
}

describe('RestoreService', () => {
    const roots: string[] = []
    let configDir = ''
    let history: ConfigHistory
    let guard: FakeGuard
    let service: RestoreService
    let initialId = ''

    beforeEach(async () => {
        const root = await makeTempDir('restore')
        roots.push(root)
        configDir = join(root, 'config')
        history = new ConfigHistory(configDir, join(root, 'history.git'))
        await history.init()
        await writeFile(join(configDir, 'configuration.yaml'), 'v1\n')
        initialId = (await history.snapshot({ kind: 'manual', title: 'v1' }))?.id ?? ''
        await writeFile(join(configDir, 'configuration.yaml'), 'v2\n')
        await writeFile(join(configDir, 'custom.yaml'), 'x\n')
        await history.snapshot({ kind: 'ai-change', title: 'v2' })
        guard = new FakeGuard()
        service = new RestoreService(history, guard)
    })

    after(async () => {
        await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
    })

    it('restores, verifies and reloads', async () => {
        const result = await service.restore(initialId, 'Kuba')
        assert.equal(result.checkPassed, true)
        assert.equal(result.needsRestart, false)
        assert.equal(result.version?.kind, 'restore')
        assert.equal(guard.reloads, 1)
        assert.equal(await readFile(join(configDir, 'configuration.yaml'), 'utf8'), 'v1\n')
    })

    it('reverts when the restored configuration is invalid', async () => {
        guard.valid = false
        const result = await service.restore(initialId, 'Kuba')
        assert.equal(result.checkPassed, false)
        assert.equal(guard.reloads, 0)
        assert.match(result.message, /Invalid config/)
        assert.equal(await readFile(join(configDir, 'configuration.yaml'), 'utf8'), 'v2\n')
        assert.equal(await readFile(join(configDir, 'custom.yaml'), 'utf8'), 'x\n')
        const kinds = (await history.list(10, null)).versions.map((version) => version.kind)
        assert.deepEqual(kinds.slice(0, 3), ['restore', 'restore', 'ai-change'])
    })

    it('returns no version when already at the target', async () => {
        const current = await history.currentVersionId()
        const result = await service.restore(current, 'Kuba')
        assert.equal(result.version, null)
        assert.equal(result.checkPassed, true)
    })

    it('detects paths that need a restart', () => {
        assert.equal(needsRestartFor(['.storage/core.entity_registry']), true)
        assert.equal(needsRestartFor(['custom_components/x/__init__.py']), true)
        assert.equal(needsRestartFor(['automations.yaml']), false)
    })
})
