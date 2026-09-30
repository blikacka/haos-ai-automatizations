import type { AccountState } from '../../shared/api.js'
import { callbackTarget } from './browserLogin.js'
import {
    CODEX_METHODS,
    type BrowserLoginResponse,
    type DeviceCodeLoginResponse,
} from './protocol.js'
import { SHORT_REQUEST_TIMEOUT_MS } from './rpcClient.js'

/** Login in progress (device code or browser OAuth). */
export type PendingLogin = Extract<AccountState, { status: 'pendingLogin' | 'pendingBrowserLogin' }>

/** Session subset needed to start a login. */
export interface LoginSession {
    request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T>
}

/**
 * Starts the device code login (`chatgptDeviceCode`).
 *
 * @param session user's Codex session
 * @returns pending state with the verification URL and one-time code
 * @throws Error on an unexpected Codex response
 */
export async function startDeviceCodeLogin(session: LoginSession): Promise<PendingLogin> {
    const response = await session.request<DeviceCodeLoginResponse>(
        CODEX_METHODS.loginStart,
        { type: 'chatgptDeviceCode' },
        SHORT_REQUEST_TIMEOUT_MS,
    )
    if (response?.type !== 'chatgptDeviceCode' || typeof response.loginId !== 'string') {
        throw new Error('Unexpected login response from Codex')
    }
    return {
        status: 'pendingLogin',
        loginId: response.loginId,
        verificationUrl: response.verificationUrl,
        userCode: response.userCode,
    }
}

/**
 * Starts the browser OAuth login (`chatgpt`); Codex listens for the callback inside the container.
 *
 * @param session user's Codex session
 * @returns pending state with the authorization URL
 * @throws Error / BrowserLoginError on an unexpected Codex response
 */
export async function startBrowserLogin(session: LoginSession): Promise<PendingLogin> {
    const response = await session.request<BrowserLoginResponse>(
        CODEX_METHODS.loginStart,
        { type: 'chatgpt' },
        SHORT_REQUEST_TIMEOUT_MS,
    )
    if (response?.type !== 'chatgpt' || typeof response.loginId !== 'string' || typeof response.authUrl !== 'string') {
        throw new Error('Unexpected login response from Codex')
    }
    callbackTarget(response.authUrl)
    return { status: 'pendingBrowserLogin', loginId: response.loginId, authUrl: response.authUrl }
}
