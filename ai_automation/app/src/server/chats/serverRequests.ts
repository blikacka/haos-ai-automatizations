import { logger } from '../util/logger.js'
import type { ChatServerRequestHandler } from './ports.js'
import { readString } from './unknownValue.js'

/** Active turn able to forward a user-input request to the chat UI. */
export interface UserInputTarget {
    /**
     * Shows the questions and resolves once the user answers.
     *
     * @param params raw `item/tool/requestUserInput` params
     * @returns response `{answers: {[questionId]: {answers: string[]}}}`
     */
    askUser(params: unknown): Promise<unknown>
}

/** Resolves the active turn for a thread id. */
export type UserInputTargetResolver = (threadId: string | null) => UserInputTarget | null

/** Request asking the user for input. */
export const USER_INPUT_METHOD = 'item/tool/requestUserInput'

/** v2 approval requests – reply `{decision: 'accept'}`. */
const APPROVAL_METHODS = new Set<string>([
    'item/commandExecution/requestApproval',
    'item/fileChange/requestApproval',
])

/** Legacy v1 approval requests – they use ReviewDecision, where the accept value is 'approved'. */
const LEGACY_APPROVAL_METHODS = new Set<string>([
    'execCommandApproval',
    'applyPatchApproval',
])

/**
 * Creates the per-session server request handler: user input is routed to the active turn,
 * approvals are auto-accepted (safety is enforced by instructions and the config guard),
 * everything else is rejected.
 *
 * @param resolveTarget finds the active turn of a thread
 * @returns handler for CodexSession.setServerRequestHandler
 */
export function createServerRequestHandler(resolveTarget: UserInputTargetResolver): ChatServerRequestHandler {
    return async (method, params) => {
        if (APPROVAL_METHODS.has(method)) {
            return { decision: 'accept' }
        }
        if (LEGACY_APPROVAL_METHODS.has(method)) {
            return { decision: 'approved' }
        }
        if (method === USER_INPUT_METHOD) {
            const target = resolveTarget(readString(params, 'threadId'))
            if (target === null) {
                throw new Error('No active turn for this thread')
            }
            return target.askUser(params)
        }
        logger.warn('Unsupported server request from Codex', { method })
        throw new Error(`Unsupported server request: ${method}`)
    }
}
