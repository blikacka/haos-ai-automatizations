import assert from 'node:assert/strict'
import {
    access,
    mkdir,
    readFile,
    rm,
    writeFile,
} from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
    after,
    before,
    describe,
    it,
} from 'node:test'
import {
    ConfigHistory,
    HistoryError,
} from '../dist/server/history/configHistory.js'
import { makeTempDir } from './helpers.ts'

const execFileAsync = promisify(execFile)

const exists = async (path: string): Promise<boolean> => access(path).then(() => true, () => false)

describe('ConfigHistory', () => {
    let root = ''
    let configDir = ''
    let history: ConfigHistory

    before(async () => {
        root = await makeTempDir('history')
        configDir = join(root, 'config')
        await mkdir(join(configDir, '.storage'), { recursive: true })
        await mkdir(join(configDir, 'tts'), { recursive: true })
        await writeFile(join(configDir, 'configuration.yaml'), 'default_config:\n')
        await writeFile(join(configDir, 'automations.yaml'), '[]\n')
        await writeFile(join(configDir, 'home-assistant_v2.db'), 'binary')
        await writeFile(join(configDir, 'home-assistant.log'), 'log')
        await writeFile(join(configDir, '.storage', 'auth'), 'secret')
        await writeFile(join(configDir, '.storage', 'core.entity_registry'), '{}')
        await writeFile(join(configDir, 'tts', 'voice.mp3'), 'audio')
        history = new ConfigHistory(configDir, join(root, 'data', 'history.git'))
        await history.init()
    })

    after(async () => {
        await rm(root, { recursive: true, force: true })
    })

    it('creates an initial version without a .git in the work tree', async () => {
        assert.equal(await exists(join(configDir, '.git')), false)
        const list = await history.list(10, null)
        assert.equal(list.versions.length, 1)
        const initial = list.versions[0]
        assert.equal(initial?.kind, 'initial')
        assert.equal(initial?.isCurrent, true)
        assert.equal(initial?.filesChanged, 2)
    })

    it('is idempotent', async () => {
        const head = await history.currentVersionId()
        await history.init()
        assert.equal(await history.currentVersionId(), head)
    })

    it('honours the exclude list', async () => {
        const initial = await history.detail(await history.currentVersionId())
        const paths = initial.files.map((file) => file.path).sort()
        assert.deepEqual(paths, ['automations.yaml', 'configuration.yaml'])
        assert.ok(initial.files.every((file) => file.changeKind === 'add' && file.diff === ''))
    })

    it('returns null snapshot when nothing changed', async () => {
        assert.equal(await history.snapshot({ kind: 'manual', title: 'noop' }), null)
    })

    it('snapshots changes with trailers and diffs', async () => {
        await writeFile(join(configDir, 'automations.yaml'), '- id: a1\n  alias: Test\n')
        await writeFile(join(configDir, 'scripts.yaml'), 'hello: {}\n')
        assert.equal((await history.diffWorkTree()).length, 2)
        const version = await history.snapshot({
            kind: 'ai-change', title: 'Přidej\nautomatizaci', chatId: 'chat1', userName: 'Kuba',
        })
        assert.ok(version)
        assert.equal(version.kind, 'ai-change')
        assert.equal(version.title, 'Přidej automatizaci')
        assert.equal(version.chatId, 'chat1')
        assert.equal(version.userName, 'Kuba')
        assert.equal(version.filesChanged, 2)
        const detail = await history.detail(version.shortId)
        const automations = detail.files.find((file) => file.path === 'automations.yaml')
        assert.equal(automations?.changeKind, 'update')
        assert.match(automations?.diff ?? '', /\+- id: a1/)
        assert.equal(detail.files.find((file) => file.path === 'scripts.yaml')?.changeKind, 'add')
        assert.deepEqual(await history.diffWorkTree(), [])
    })

    it('restores an older version (deleting newer files) and can undo the restore', async () => {
        const list = await history.list(10, null)
        const [newer, initial] = list.versions
        assert.ok(newer && initial)
        await writeFile(join(configDir, 'configuration.yaml'), 'default_config:\nmanual: true\n')

        const restored = await history.restore(initial.id, 'Kuba')
        assert.ok(restored.version)
        assert.equal(restored.version.kind, 'restore')
        assert.equal(restored.version.restoredFrom, initial.id)
        assert.equal(await exists(join(configDir, 'scripts.yaml')), false)
        assert.equal(await readFile(join(configDir, 'automations.yaml'), 'utf8'), '[]\n')
        assert.equal(await readFile(join(configDir, 'configuration.yaml'), 'utf8'), 'default_config:\n')
        assert.equal(await exists(join(configDir, 'home-assistant_v2.db')), true)
        assert.equal(await exists(join(configDir, '.storage', 'auth')), true)
        assert.deepEqual([...restored.changedPaths].sort(), ['automations.yaml', 'configuration.yaml', 'scripts.yaml'])

        const afterRestore = await history.list(10, null)
        assert.deepEqual(afterRestore.versions.map((version) => version.kind), ['restore', 'manual', 'ai-change', 'initial'])
        const manual = afterRestore.versions[1]
        assert.ok(manual)

        const undo = await history.restore(manual.id, 'Kuba')
        assert.ok(undo.version)
        assert.equal(await readFile(join(configDir, 'scripts.yaml'), 'utf8'), 'hello: {}\n')
        assert.match(await readFile(join(configDir, 'configuration.yaml'), 'utf8'), /manual: true/)
        assert.equal((await history.restore(manual.id, 'Kuba')).version, null)
    })

    it('paginates with a cursor', async () => {
        const firstPage = await history.list(2, null)
        assert.equal(firstPage.versions.length, 2)
        assert.equal(firstPage.versions[0]?.isCurrent, true)
        assert.ok(firstPage.nextCursor)
        const secondPage = await history.list(10, firstPage.nextCursor)
        assert.equal(secondPage.nextCursor, null)
        assert.equal(firstPage.versions.length + secondPage.versions.length, 5)
        assert.equal(secondPage.versions.at(-1)?.kind, 'initial')
    })

    it('records deleted files', async () => {
        await rm(join(configDir, 'scripts.yaml'))
        const version = await history.snapshot({ kind: 'manual', title: 'delete' })
        assert.ok(version)
        const detail = await history.detail(version.id)
        assert.deepEqual(detail.files.map((file) => [file.path, file.changeKind]), [['scripts.yaml', 'delete']])
    })

    it('rejects invalid and unknown version ids', async () => {
        await assert.rejects(history.detail('HEAD~1'), (error: unknown) => error instanceof HistoryError && error.status === 400)
        await assert.rejects(history.detail('--all'), HistoryError)
        await assert.rejects(history.restore('deadbeefdeadbeef', 'x'), (error: unknown) => error instanceof HistoryError && error.status === 404)
    })

    it('untracks files that became excluded when init runs again', async () => {
        const gitDir = join(root, 'data', 'history.git')
        await mkdir(join(configDir, 'custom_components', 'hacs'), { recursive: true })
        await writeFile(join(configDir, 'custom_components', 'hacs', 'bundle.js'), 'x\n')
        const git = (...args: string[]) => execFileAsync('git', ['--git-dir', gitDir, '--work-tree', configDir, ...args])
        await git('add', '-f', 'custom_components/hacs/bundle.js')
        await git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'forced')
        await history.init()
        const tracked = (await git('ls-files')).stdout.split('\n')
        assert.ok(!tracked.includes('custom_components/hacs/bundle.js'))
        assert.ok(await exists(join(configDir, 'custom_components', 'hacs', 'bundle.js')))
        const latest = (await history.list(1, null)).versions[0]
        assert.equal(latest?.kind, 'manual')
    })
})
