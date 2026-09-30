import type {
    ConfigCheckResult,
    FileDiff,
} from '../../shared/api.js'
import type {
    ChatConfigGuard,
    ChatHistory,
} from './ports.js'

/** Outcome of verifying the configuration after an AI turn. */
export interface TurnVerification {
    /** Whether the work tree differs from HEAD or HEAD moved away from the base version. */
    changed: boolean
    /** Config check result; null when nothing changed (no check performed). */
    check: ConfigCheckResult | null
    /** Changed files (empty when unchanged). */
    files: FileDiff[]
}

/** Detects configuration changes made by a turn and validates them. */
export class TurnVerifier {
    /**
     * @param history configuration history (work tree diff)
     * @param guard configuration guard (check_config)
     */
    public constructor(
        private readonly history: Pick<ChatHistory, 'diffWorkTree' | 'currentVersionId'>,
        private readonly guard: Pick<ChatConfigGuard, 'checkConfig'>,
    ) {
    }

    /**
     * Diffs the work tree and runs check_config only when something changed.
     * When a base version is given, commits created during the turn (e.g. by `haos-tool snapshot`)
     * also count as a change.
     *
     * @param baseVersionId version current before the turn started
     * @returns verification outcome
     * @throws Error when git or Home Assistant cannot be reached
     */
    public async verify(baseVersionId: string | null = null): Promise<TurnVerification> {
        const files = await this.history.diffWorkTree()
        const headMoved = baseVersionId !== null && await this.history.currentVersionId() !== baseVersionId
        if (files.length === 0 && !headMoved) {
            return { changed: false, check: null, files }
        }
        const check = await this.guard.checkConfig()
        return { changed: true, check, files }
    }
}
