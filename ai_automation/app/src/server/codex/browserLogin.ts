/**
 * Browser (OAuth) login support for headless add-on use.
 *
 * Codex starts a callback server on 127.0.0.1:<port> inside the add-on container and returns an
 * `authUrl` whose `redirect_uri` points to `http://localhost:<port>/auth/callback`. The user's browser
 * cannot reach the container, so the user pastes the final address from the address bar and the add-on
 * forwards only `code` + `state` to the local callback server. The target host and port come from the
 * Codex generated `authUrl`, never from user input (no SSRF); PKCE + state are verified by Codex.
 */

/** Error with a user-facing Czech message. */
export class BrowserLoginError extends Error {
    public constructor(message: string) {
        super(message)
        this.name = 'BrowserLoginError'
    }
}

/** Local callback endpoint derived from the Codex auth URL. */
export interface CallbackTarget {
    port: number
    path: string
}

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1'])
const FORWARDED_PARAMS: readonly string[] = ['code', 'state', 'scope']
const MAX_PARAM_LENGTH = 4096
const MAX_CALLBACK_URL_LENGTH = 8192
const FORWARD_TIMEOUT_MS = 20_000
const INVALID_ADDRESS = 'Vložená adresa není platná. Zkopírujte celou adresu z adresního řádku '
    + '(začíná http://localhost:1455/auth/callback?code=…).'

function parseUrl(value: string): URL | null {
    try {
        return new URL(value)
    } catch {
        return null
    }
}

/**
 * Reads the local callback endpoint from the Codex auth URL (`redirect_uri` query parameter).
 *
 * @param authUrl URL returned by `account/login/start`
 * @returns callback port and path
 * @throws BrowserLoginError when the redirect is not a local http URL
 */
export function callbackTarget(authUrl: string): CallbackTarget {
    const redirect = parseUrl(parseUrl(authUrl)?.searchParams.get('redirect_uri') ?? '')
    const port = Number(redirect?.port)
    if (redirect === null || redirect.protocol !== 'http:' || !LOCAL_HOSTS.has(redirect.hostname)
        || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new BrowserLoginError('Codex vrátil neočekávanou přihlašovací adresu.')
    }
    return { port, path: redirect.pathname }
}

/**
 * Builds the URL forwarded to the local Codex callback server from the address pasted by the user.
 * Accepts the full address or just its query part (`?code=…&state=…`).
 *
 * @param target callback endpoint from {@link callbackTarget}
 * @param pasted user input
 * @returns URL on 127.0.0.1 with only the OAuth parameters
 * @throws BrowserLoginError on malformed input, wrong path or missing code/state
 */
export function buildForwardUrl(target: CallbackTarget, pasted: string): string {
    const trimmed = pasted.trim()
    if (trimmed === '' || trimmed.length > MAX_CALLBACK_URL_LENGTH) {
        throw new BrowserLoginError(INVALID_ADDRESS)
    }
    const source = trimmed.startsWith('?') ? parseUrl(`http://localhost${target.path}${trimmed}`) : parseUrl(trimmed)
    if (source === null || source.pathname !== target.path) {
        throw new BrowserLoginError(INVALID_ADDRESS)
    }
    const oauthError = source.searchParams.get('error')
    if (oauthError !== null) {
        const description = source.searchParams.get('error_description') ?? oauthError
        throw new BrowserLoginError(`OpenAI přihlášení odmítl: ${description.slice(0, 300)}`)
    }
    const forward = new URL(`http://127.0.0.1:${target.port}${target.path}`)
    for (const name of FORWARDED_PARAMS) {
        const value = source.searchParams.get(name)
        if (value !== null && value.length <= MAX_PARAM_LENGTH) {
            forward.searchParams.set(name, value)
        }
    }
    if (!forward.searchParams.has('code') || !forward.searchParams.has('state')) {
        throw new BrowserLoginError(INVALID_ADDRESS)
    }
    return forward.href
}

/**
 * Delivers the OAuth callback to the local Codex login server.
 *
 * @param forwardUrl URL from {@link buildForwardUrl}
 * @throws BrowserLoginError when Codex rejects the callback or is not listening
 */
export async function forwardCallback(forwardUrl: string): Promise<void> {
    let response: Response
    try {
        response = await fetch(forwardUrl, { redirect: 'manual', signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS) })
    } catch {
        throw new BrowserLoginError('Přihlášení vypršelo nebo již bylo dokončeno. Začněte prosím znovu.')
    }
    await response.body?.cancel().catch(() => undefined)
    if (response.status >= 400) {
        throw new BrowserLoginError('Codex přihlašovací kód nepřijal (neplatný nebo už použitý). Začněte prosím znovu.')
    }
}
