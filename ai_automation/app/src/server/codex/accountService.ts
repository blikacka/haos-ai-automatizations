import type {
    AccountState,
    ServerEvent,
} from '../../shared/api.js'
import { logger } from '../util/logger.js'
import {
    CODEX_METHODS,
    type AccountLoginCompletedNotification,
    type DeviceCodeLoginResponse,
    type GetAccountResponse,
} from './protocol.js'
import { SHORT_REQUEST_TIMEOUT_MS } from './rpcClient.js'

/** Publishes server events to one user's browsers (satisfied by EventHub). */
export interface EventPublisher {
    publish(userId: string, event: ServerEvent): void
}

/** Session subset used by the account service. */
export interface AccountSession {
    request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T>
    on(event: 'notification', listener: (method: string, params: unknown) => void): unknown
    on(event: 'exit', listener: (code: number | null) => void): unknown
}

/** Pool subset used by the account service. */
export interface AccountSessionPool {
    get(userId: string): Promise<AccountSession>
    on(event: 'session', listener: (userId: string, session: AccountSession) => void): unknown
}

type PendingLogin = Extract<AccountState, { status: 'pendingLogin' }>

/** Device codes expire; a pending login is forgotten after this time. */
const PENDING_LOGIN_TTL_MS = 15 * 60 * 1000

/**
 * Converts the `account/read` response into the UI account state.
 *
 * @param response raw response
 * @returns account state
 */
export function toAccountState(response: GetAccountResponse | null | undefined): AccountState {
    const account = response?.account ?? null
    if (account === null || typeof account !== 'object') {
        return { status: 'loggedOut' }
    }
    if (account.type === 'chatgpt') {
        return {
            status: 'loggedIn',
            email: typeof account.email === 'string' ? account.email : null,
            planType: typeof account.planType === 'string' ? account.planType : null,
        }
    }
    return { status: 'loggedIn', email: null, planType: null }
}

/** ChatGPT account login / logout of each HA user through their Codex session. */
export class AccountService {
    private readonly pendingLogins = new Map<string, PendingLogin>()
    private readonly pendingTimers = new Map<string, NodeJS.Timeout>()
    private readonly attachedSessions = new WeakSet<AccountSession>()

    /**
     * @param pool Codex session pool
     * @param hub event publisher
     */
    public constructor(private readonly pool: AccountSessionPool, private readonly hub: EventPublisher) {
        pool.on('session', (userId, session) => this.attach(userId, session))
    }

    /**
     * Returns the account state (pending login wins over the stored state).
     *
     * @param userId HA user id
     * @returns account state
     */
    public async getAccount(userId: string): Promise<AccountState> {
        const pending = this.pendingLogins.get(userId)
        if (pending !== undefined) {
            return pending
        }
        return this.readAccount(userId)
    }

    /**
     * Starts the device code login (or returns the running one / the logged-in state).
     *
     * @param userId HA user id
     * @returns pendingLogin state with the verification URL and user code
     */
    public async startLogin(userId: string): Promise<AccountState> {
        const current = await this.getAccount(userId)
        if (current.status !== 'loggedOut') {
            return current
        }
        const session = await this.sessionFor(userId)
        const response = await session.request<DeviceCodeLoginResponse>(
            CODEX_METHODS.loginStart,
            { type: 'chatgptDeviceCode' },
            SHORT_REQUEST_TIMEOUT_MS,
        )
        if (response?.type !== 'chatgptDeviceCode' || typeof response.loginId !== 'string') {
            throw new Error('Unexpected login response from Codex')
        }
        const pending: PendingLogin = {
            status: 'pendingLogin',
            loginId: response.loginId,
            verificationUrl: response.verificationUrl,
            userCode: response.userCode,
        }
        this.setPending(userId, pending)
        logger.info('Codex device code login started')
        return pending
    }

    /**
     * Cancels a pending login.
     *
     * @param userId HA user id
     * @returns resulting account state
     */
    public async cancelLogin(userId: string): Promise<AccountState> {
        await this.cancelPending(userId)
        return this.readAccount(userId)
    }

    /**
     * Logs the user out of ChatGPT (cancelling a pending login first).
     *
     * @param userId HA user id
     * @returns resulting account state
     */
    public async logout(userId: string): Promise<AccountState> {
        await this.cancelPending(userId)
        const session = await this.sessionFor(userId)
        await session.request(CODEX_METHODS.logout, {}, SHORT_REQUEST_TIMEOUT_MS)
        return this.readAccount(userId)
    }

    private async sessionFor(userId: string): Promise<AccountSession> {
        const session = await this.pool.get(userId)
        this.attach(userId, session)
        return session
    }

    private async readAccount(userId: string): Promise<AccountState> {
        const session = await this.sessionFor(userId)
        const response = await session.request<GetAccountResponse>(
            CODEX_METHODS.accountRead,
            { refreshToken: false },
            SHORT_REQUEST_TIMEOUT_MS,
        )
        return toAccountState(response)
    }

    private attach(userId: string, session: AccountSession): void {
        if (this.attachedSessions.has(session)) {
            return
        }
        this.attachedSessions.add(session)
        session.on('notification', (method, params) => this.handleNotification(userId, method, params))
        session.on('exit', () => {
            if (this.pendingLogins.has(userId)) {
                this.clearPending(userId)
                this.publishFresh(userId)
            }
        })
    }

    private handleNotification(userId: string, method: string, params: unknown): void {
        if (method === CODEX_METHODS.loginCompleted) {
            const completed = params as Partial<AccountLoginCompletedNotification> | null
            const pending = this.pendingLogins.get(userId)
            const loginId = completed?.loginId ?? null
            if (pending !== undefined && loginId !== null && loginId !== pending.loginId) {
                return
            }
            if (completed?.success !== true) {
                logger.warn('Codex login did not succeed', { reason: completed?.error ?? null })
            }
            this.clearPending(userId)
            this.publishFresh(userId)
        } else if (method === CODEX_METHODS.accountUpdated && !this.pendingLogins.has(userId)) {
            this.publishFresh(userId)
        }
    }

    private publishFresh(userId: string): void {
        this.readAccount(userId)
            .then((account) => this.hub.publish(userId, { type: 'account.updated', account }))
            .catch((error: unknown) => logger.warn('Cannot re-read Codex account', { error }))
    }

    private setPending(userId: string, pending: PendingLogin): void {
        this.clearPending(userId)
        this.pendingLogins.set(userId, pending)
        const timer = setTimeout(() => {
            if (this.pendingLogins.get(userId) === pending) {
                this.clearPending(userId)
                this.publishFresh(userId)
            }
        }, PENDING_LOGIN_TTL_MS)
        timer.unref()
        this.pendingTimers.set(userId, timer)
    }

    private clearPending(userId: string): void {
        this.pendingLogins.delete(userId)
        const timer = this.pendingTimers.get(userId)
        if (timer !== undefined) {
            clearTimeout(timer)
            this.pendingTimers.delete(userId)
        }
    }

    private async cancelPending(userId: string): Promise<void> {
        const pending = this.pendingLogins.get(userId)
        if (pending === undefined) {
            return
        }
        this.clearPending(userId)
        try {
            const session = await this.sessionFor(userId)
            await session.request(CODEX_METHODS.loginCancel, { loginId: pending.loginId }, SHORT_REQUEST_TIMEOUT_MS)
        } catch (error) {
            logger.warn('Cancelling Codex login failed', { error })
        }
    }
}
