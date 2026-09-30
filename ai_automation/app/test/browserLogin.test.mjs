import assert from 'node:assert/strict'
import {
    mkdir,
    mkdtemp,
    rm,
    writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import {
    after,
    before,
    describe,
    it,
} from 'node:test'
import { fileURLToPath } from 'node:url'
import {
    BrowserLoginError,
    buildForwardUrl,
    callbackTarget,
} from '../dist/server/codex/browserLogin.js'
import { AccountService } from '../dist/server/codex/accountService.js'
import { CodexSessionPool } from '../dist/server/codex/sessionPool.js'
import { setLogLevel } from '../dist/server/util/logger.js'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const fakeCodex = join(appDir, 'test', 'fixtures', 'fake-codex.mjs')
const scratchRoot = join(appDir, '..', '..', 'tmp')
const AUTH_URL = 'https://auth.openai.com/oauth/authorize?response_type=code&client_id=x'
    + `&redirect_uri=${encodeURIComponent('http://localhost:1455/auth/callback')}&state=abc`
const TARGET = { port: 1455, path: '/auth/callback' }

setLogLevel('error')

describe('browserLogin helpers', () => {
    it('reads the local callback target from the auth URL', () => {
        assert.deepEqual(callbackTarget(AUTH_URL), TARGET)
    })

    it('rejects auth URLs redirecting to non-local hosts', () => {
        const evil = AUTH_URL.replace(encodeURIComponent('localhost:1455'), encodeURIComponent('evil.example:1455'))
        assert.throws(() => callbackTarget(evil), BrowserLoginError)
        assert.throws(() => callbackTarget('not a url'), BrowserLoginError)
    })

    it('forwards only OAuth params to 127.0.0.1 on the Codex port', () => {
        const url = buildForwardUrl(TARGET, ' http://localhost:1455/auth/callback?code=C1&state=S1&scope=openid&x=1 ')
        assert.equal(url, 'http://127.0.0.1:1455/auth/callback?code=C1&state=S1&scope=openid')
        assert.equal(buildForwardUrl(TARGET, '?code=C2&state=S2'), 'http://127.0.0.1:1455/auth/callback?code=C2&state=S2')
    })

    it('ignores the host and port given by the user (no SSRF)', () => {
        const url = buildForwardUrl(TARGET, 'http://169.254.169.254:80/auth/callback?code=C&state=S')
        assert.equal(new URL(url).host, '127.0.0.1:1455')
    })

    it('rejects wrong paths, missing params and OAuth errors', () => {
        assert.throws(() => buildForwardUrl(TARGET, 'http://localhost:1455/other?code=C&state=S'), BrowserLoginError)
        assert.throws(() => buildForwardUrl(TARGET, 'http://localhost:1455/auth/callback?code=C'), BrowserLoginError)
        assert.throws(() => buildForwardUrl(TARGET, ''), BrowserLoginError)
        assert.throws(
            () => buildForwardUrl(TARGET, 'http://localhost:1455/auth/callback?error=access_denied&error_description=Workspace'),
            (error) => error instanceof BrowserLoginError && error.message.includes('Workspace'),
        )
    })
})

describe('AccountService browser login', () => {
    let workDir = ''
    let pool = null
    const events = []
    const hub = { publish: (userId, event) => events.push({ userId, event }) }

    before(async () => {
        workDir = await mkdtemp(join(scratchRoot, 'browser-login-'))
        const env = {
            port: 0, haConfigDir: join(workDir, 'config'), dataDir: join(workDir, 'data'), supervisorUrl: 'http://127.0.0.1:1',
            supervisorToken: '', codexBin: fakeCodex, webDir: workDir, agentDir: join(workDir, 'agent'),
            allowAnyOriginIp: true, addonVersion: '1.2.3',
        }
        await mkdir(env.haConfigDir, { recursive: true })
        await mkdir(env.agentDir, { recursive: true })
        await writeFile(join(env.agentDir, 'AGENTS.md'), '# agent rules\n')
        pool = new CodexSessionPool(env)
    })

    after(async () => {
        await pool.stopAll()
        await rm(workDir, { recursive: true, force: true })
    })

    it('completes the login with the pasted callback address', async () => {
        const accounts = new AccountService(pool, hub)
        const pending = await accounts.startLogin('user-b', 'browser')
        assert.equal(pending.status, 'pendingBrowserLogin')
        const redirect = new URL(new URL(pending.authUrl).searchParams.get('redirect_uri'))
        const state = new URL(pending.authUrl).searchParams.get('state')

        await assert.rejects(
            accounts.completeBrowserLogin('user-b', `${redirect.href}?code=wrong&state=${state}`),
            BrowserLoginError,
        )
        const account = await accounts.completeBrowserLogin('user-b', `${redirect.href}?code=fake-code&state=${state}`)
        assert.equal(account.status, 'loggedIn')
        assert.deepEqual(await accounts.getAccount('user-b'), account)
    })

    it('blocks a second concurrent browser login and switches methods', async () => {
        const accounts = new AccountService(pool, hub)
        await accounts.startLogin('user-c', 'browser')
        await assert.rejects(accounts.startLogin('user-d', 'browser'), BrowserLoginError)
        const device = await accounts.startLogin('user-c', 'deviceCode')
        assert.equal(device.status, 'pendingLogin')
        const browser = await accounts.startLogin('user-d', 'browser')
        assert.equal(browser.status, 'pendingBrowserLogin')
        await accounts.cancelLogin('user-c')
        assert.deepEqual(await accounts.cancelLogin('user-d'), { status: 'loggedOut' })
    })

    it('refuses to complete when no browser login is pending', async () => {
        const accounts = new AccountService(pool, hub)
        await assert.rejects(accounts.completeBrowserLogin('user-e', '?code=a&state=b'), BrowserLoginError)
    })
})
