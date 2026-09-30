import type { CurrentUser } from '../../shared/api.js'
import { logger } from '../util/logger.js'
import {
    activityEntry,
    snapshotEntry,
    verificationEntry,
} from './chatEntries.js'
import type { LiveChat } from './liveChat.js'
import type {
    ChatConfigGuard,
    ChatEventPublisher,
    ChatHistory,
} from './ports.js'
import {
    TurnVerifier,
    type TurnVerification,
} from './turnVerifier.js'
import { errorMessage } from './unknownValue.js'

/** Runs the automatic repair turn with the given prompt. */
export type RepairTurnRunner = (prompt: string) => Promise<void>

/** Context of one verification. */
export interface VerificationContext {
    live: LiveChat
    user: CurrentUser
    prompt: string
    baseVersionId: string
    allowRepair: boolean
    runRepairTurn: RepairTurnRunner
}

const MAX_ERROR_TEXT = 2000
const MAX_TITLE_LENGTH = 100
const FALLBACK_TITLE = 'Změna provedená AI'

/**
 * Builds the prompt of the automatic repair turn.
 *
 * @param errors check_config errors
 * @returns prompt text
 */
export function buildRepairPrompt(errors: string): string {
    return `Automatická kontrola konfigurace selhala: ${errors}. Oprav to, spusť \`haos-tool check-config\` `
        + 'a pokračuj, dokud nebude konfigurace platná. Potom použij `haos-tool reload` a stručně shrň, co jsi opravil.'
}

function versionTitle(prompt: string): string {
    const firstLine = prompt.split('\n', 1)[0]?.trim() ?? ''
    return firstLine === '' ? FALLBACK_TITLE : firstLine.slice(0, MAX_TITLE_LENGTH)
}

function errorsText(verification: TurnVerification): string {
    const errors = verification.check?.errors ?? 'neznámá chyba'
    return errors.length > MAX_ERROR_TEXT ? `${errors.slice(0, MAX_ERROR_TEXT)}…` : errors
}

function isValid(verification: TurnVerification): boolean {
    return !verification.changed || verification.check?.valid === true
}

/**
 * Verifies the configuration after a turn (SPEC turn flow step 5): records an ai-change version
 * when valid, otherwise runs one repair turn and finally restores the base version.
 */
export class VerificationFlow {
    private readonly verifier: TurnVerifier

    /**
     * @param history configuration history
     * @param guard configuration guard
     * @param hub event publisher (history.updated broadcasts)
     */
    public constructor(
        private readonly history: ChatHistory,
        private readonly guard: ChatConfigGuard,
        private readonly hub: ChatEventPublisher,
    ) {
        this.verifier = new TurnVerifier(history, guard)
    }

    /**
     * Runs verification, repair and rollback.
     *
     * @param context chat, user, prompt and base version
     * @returns true when the configuration ended valid (or unchanged)
     */
    public async run(context: VerificationContext): Promise<boolean> {
        context.live.setStatus('verifying')
        let verification = await this.safeVerify(context)
        if (verification === null) {
            return false
        }
        if (!verification.changed) {
            return true
        }
        if (isValid(verification)) {
            await this.recordSuccess(context, false)
            return true
        }
        if (context.allowRepair) {
            const errors = errorsText(verification)
            context.live.putEntry(activityEntry('tool', 'Automatická oprava konfigurace', errors))
            context.live.setStatus('running')
            await context.runRepairTurn(buildRepairPrompt(errors))
            context.live.setStatus('verifying')
            verification = await this.safeVerify(context)
            if (verification === null) {
                return false
            }
            if (isValid(verification)) {
                if (verification.changed) {
                    await this.recordSuccess(context, true)
                } else {
                    context.live.putEntry(verificationEntry(
                        'passed',
                        'Po automatické opravě je konfigurace platná a shodná s původním stavem.',
                        await this.history.currentVersionId(),
                    ))
                }
                return true
            }
        }
        await this.rollback(context, errorsText(verification))
        return false
    }

    private async safeVerify(context: VerificationContext): Promise<TurnVerification | null> {
        try {
            return await this.verifier.verify(context.baseVersionId)
        } catch (error) {
            logger.error('Configuration verification failed', { error: errorMessage(error) })
            context.live.putEntry(verificationEntry(
                'failed',
                `Konfiguraci se nepodařilo ověřit: ${errorMessage(error)}`,
                null,
            ))
            return null
        }
    }

    private async recordSuccess(context: VerificationContext, repaired: boolean): Promise<void> {
        const version = await this.history.snapshot({
            kind: 'ai-change',
            title: versionTitle(context.prompt),
            chatId: context.live.chat.id,
            userName: context.user.displayName || context.user.name,
        })
        const versionId = version?.id ?? await this.history.currentVersionId()
        const message = repaired
            ? 'Konfigurace byla po automatické opravě zkontrolována a je platná.'
            : 'Konfigurace byla zkontrolována a je platná.'
        context.live.putEntry(verificationEntry('passed', message, versionId))
        if (version !== null) {
            context.live.putEntry(snapshotEntry(version.id, version.title))
        }
        this.hub.broadcast({ type: 'history.updated' })
    }

    private async rollback(context: VerificationContext, errors: string): Promise<void> {
        const userName = context.user.displayName || context.user.name
        try {
            const restored = await this.history.restore(context.baseVersionId, userName, {
                pendingKind: 'ai-change',
                pendingTitle: `Nefunkční změna AI (automaticky vrácena): ${versionTitle(context.prompt)}`,
                title: 'Automatický návrat do stavu před úlohou',
                chatId: context.live.chat.id,
            })
            await this.reloadAfterRestore()
            context.live.putEntry(verificationEntry(
                'restored',
                `Konfigurace nebyla platná (${errors}). Změny byly vráceny do stavu před touto úlohou.`,
                restored.version?.id ?? context.baseVersionId,
            ))
            if (restored.version !== null) {
                context.live.putEntry(snapshotEntry(restored.version.id, restored.version.title))
            }
        } catch (error) {
            logger.error('Automatic restore failed', { error: errorMessage(error) })
            context.live.putEntry(verificationEntry(
                'failed',
                `Konfigurace není platná (${errors}) a automatické obnovení selhalo: ${errorMessage(error)}`,
                null,
            ))
        } finally {
            this.hub.broadcast({ type: 'history.updated' })
        }
    }

    private async reloadAfterRestore(): Promise<void> {
        try {
            await this.guard.reloadAll()
        } catch (error) {
            logger.warn('reload_all after restore failed', { error: errorMessage(error) })
        }
    }
}
