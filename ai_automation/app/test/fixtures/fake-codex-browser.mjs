/**
 * Browser OAuth login emulation for fake-codex.mjs: starts a real callback HTTP server on
 * 127.0.0.1 (port FAKE_CODEX_CALLBACK_PORT, default random) and returns an authUrl whose
 * redirect_uri points to http://localhost:<port>/auth/callback, like the real Codex CLI.
 * A GET /auth/callback with the right `state` and code 'fake-code' completes the login.
 */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const CALLBACK_PATH = '/auth/callback'

/**
 * @param {{ onSuccess: () => void }} handlers called once the callback is accepted
 * @returns {Promise<{ authUrl: string, close: () => void }>}
 */
export async function startFakeBrowserLogin({ onSuccess }) {
    const state = randomUUID()
    const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (url.pathname !== CALLBACK_PATH) {
            res.writeHead(404).end()
            return
        }
        if (url.searchParams.get('state') !== state || url.searchParams.get('code') !== 'fake-code') {
            res.writeHead(400).end('invalid state or code')
            return
        }
        res.writeHead(302, { Location: 'http://localhost/success' }).end()
        server.close()
        onSuccess()
    })
    const port = Number(process.env.FAKE_CODEX_CALLBACK_PORT ?? 0)
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
    const redirect = `http://localhost:${server.address().port}${CALLBACK_PATH}`
    const authUrl = `https://auth.openai.com/oauth/authorize?response_type=code&client_id=fake`
        + `&redirect_uri=${encodeURIComponent(redirect)}&state=${state}`
    return { authUrl, close: () => server.close() }
}
