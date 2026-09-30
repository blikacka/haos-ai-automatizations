import type {
    AccountState,
    LoginMethod,
} from '../../../shared/api.js'
import { BrowserLoginError } from '../../codex/browserLogin.js'
import {
    HttpError,
    type Router,
} from '../router.js'

/** Subset of AccountService used by the account routes. */
export interface AccountPort {
    getAccount(userId: string): Promise<AccountState>
    startLogin(userId: string, method?: LoginMethod): Promise<AccountState>
    completeBrowserLogin(userId: string, callbackUrl: string): Promise<AccountState>
    cancelLogin(userId: string): Promise<AccountState>
    logout(userId: string): Promise<AccountState>
}

/** Dependencies of the account routes. */
export interface AccountRouteDeps {
    accounts: AccountPort
}

/**
 * Register ChatGPT account login / logout routes.
 */
export function register(router: Router, deps: AccountRouteDeps): void {
    router.add('POST', '/api/account/login', async ({ user, body }) => (
        asUserError(() => deps.accounts.startLogin(user.id, parseMethod(body)))
    ))
    router.add('POST', '/api/account/login/callback', async ({ user, body }) => (
        asUserError(() => deps.accounts.completeBrowserLogin(user.id, parseCallbackUrl(body)))
    ))
    router.add('POST', '/api/account/login/cancel', async ({ user }) => deps.accounts.cancelLogin(user.id))
    router.add('POST', '/api/account/logout', async ({ user }) => deps.accounts.logout(user.id))
}

const MAX_CALLBACK_URL_LENGTH = 8192

function bodyField(body: unknown, name: string): unknown {
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[name] : undefined
}

function parseMethod(body: unknown): LoginMethod {
    const method = bodyField(body, 'method')
    if (method === undefined || method === 'deviceCode') {
        return 'deviceCode'
    }
    if (method === 'browser') {
        return 'browser'
    }
    throw new HttpError(400, 'Neplatný způsob přihlášení')
}

function parseCallbackUrl(body: unknown): string {
    const value = bodyField(body, 'callbackUrl')
    if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_CALLBACK_URL_LENGTH) {
        throw new HttpError(400, 'Vložte adresu z adresního řádku prohlížeče')
    }
    return value
}

async function asUserError(action: () => Promise<AccountState>): Promise<AccountState> {
    try {
        return await action()
    } catch (error) {
        if (error instanceof BrowserLoginError) {
            throw new HttpError(400, error.message)
        }
        throw error
    }
}
