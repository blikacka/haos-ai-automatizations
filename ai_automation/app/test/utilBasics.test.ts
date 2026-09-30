import assert from 'node:assert/strict'
import {
    readFile,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import {
    after,
    describe,
    it,
} from 'node:test'
import {
    isSafeId,
    newId,
    userDirName,
} from '../dist/server/util/ids.js'
import { Mutex } from '../dist/server/util/mutex.js'
import {
    readJsonFile,
    writeJsonFileAtomic,
} from '../dist/server/util/jsonFile.js'
import { loadAddonOptions } from '../dist/server/config/env.js'
import { makeTempDir } from './helpers.ts'

const tempDirs: string[] = []

after(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('ids', () => {
    it('generates unique safe ids', () => {
        const first = newId()
        assert.match(first, /^[0-9a-f]{32}$/)
        assert.notEqual(first, newId())
        assert.ok(isSafeId(first))
    })

    it('rejects unsafe ids', () => {
        assert.equal(isSafeId('../etc'), false)
        assert.equal(isSafeId(''), false)
        assert.equal(isSafeId('a'.repeat(65)), false)
        assert.equal(isSafeId('ok_id-1'), true)
    })

    it('maps user ids to stable directory names', () => {
        assert.equal(userDirName('user'), userDirName('user'))
        assert.match(userDirName('../../x'), /^[0-9a-f]{32}$/)
    })
})

describe('Mutex', () => {
    it('serializes callbacks in FIFO order', async () => {
        const mutex = new Mutex()
        const order: string[] = []
        const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))
        const first = mutex.runExclusive(async () => {
            order.push('a-start')
            await delay(20)
            order.push('a-end')
        })
        const second = mutex.runExclusive(async () => {
            order.push('b')
        })
        assert.equal(mutex.isLocked, true)
        assert.equal(mutex.queueLength, 1)
        await Promise.all([first, second])
        assert.deepEqual(order, ['a-start', 'a-end', 'b'])
        assert.equal(mutex.isLocked, false)
    })

    it('releases the lock after a failure', async () => {
        const mutex = new Mutex()
        await assert.rejects(mutex.runExclusive(async () => {
            throw new Error('boom')
        }))
        assert.equal(await mutex.runExclusive(async () => 42), 42)
        assert.equal(mutex.isLocked, false)
    })
})

describe('jsonFile', () => {
    it('writes atomically with mode 0600 and reads back', async () => {
        const dir = await makeTempDir('json')
        tempDirs.push(dir)
        const path = join(dir, 'nested', 'data.json')
        await writeJsonFileAtomic(path, { hello: 'world' })
        assert.deepEqual(await readJsonFile(path, null), { hello: 'world' })
        assert.equal((await stat(path)).mode & 0o777, 0o600)
        assert.equal((await stat(join(dir, 'nested'))).mode & 0o777, 0o700)
    })

    it('returns fallback for missing or invalid files', async () => {
        const dir = await makeTempDir('json')
        tempDirs.push(dir)
        assert.deepEqual(await readJsonFile(join(dir, 'missing.json'), { ok: 1 }), { ok: 1 })
        await writeFile(join(dir, 'bad.json'), '{not json')
        assert.equal(await readJsonFile(join(dir, 'bad.json'), 'fallback'), 'fallback')
        assert.match(await readFile(join(dir, 'bad.json'), 'utf8'), /not json/)
    })
})

describe('loadAddonOptions', () => {
    it('parses options and falls back to defaults', async () => {
        const dir = await makeTempDir('options')
        tempDirs.push(dir)
        assert.deepEqual(loadAddonOptions(dir), { defaultModel: null, defaultEffort: null, logLevel: 'info' })
        await writeFile(join(dir, 'options.json'), JSON.stringify({
            default_model: 'gpt-5', default_reasoning: 'high', log_level: 'debug',
        }))
        assert.deepEqual(loadAddonOptions(dir), { defaultModel: 'gpt-5', defaultEffort: 'high', logLevel: 'debug' })
    })
})
