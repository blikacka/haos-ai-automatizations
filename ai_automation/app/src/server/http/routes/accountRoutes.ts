import type { AccountState } from '../../../shared/api.js'
import type { Router } from '../router.js'

/** Subset of AccountService used by the account routes. */
export interface AccountPort {
    getAccount(userId: string): Promise<AccountState>
    startLogin(userId: string): Promise<AccountState>
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
    router.add('POST', '/api/account/login', async ({ user }) => deps.accounts.startLogin(user.id))
    router.add('POST', '/api/account/login/cancel', async ({ user }) => deps.accounts.cancelLogin(user.id))
    router.add('POST', '/api/account/logout', async ({ user }) => deps.accounts.logout(user.id))
}
