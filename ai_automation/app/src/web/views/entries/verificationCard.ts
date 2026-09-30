import type {
    ChatEntry,
    VerificationResult,
} from '../../../shared/api'
import {
    button,
    h,
    replaceContent,
} from '../../dom'
import { shortId } from '../../format'
import {
    icon,
    type IconName,
} from '../../icons'
import {
    entriesOfKind,
    type EntryBlock,
    type EntryContext,
    type EntryOf,
} from './types'

const RESULT_ICONS: Record<VerificationResult, IconName> = {
    passed: 'shield',
    failed: 'alert',
    restored: 'restore',
}

function headline(entry: EntryOf<'verification'>): string {
    if (entry.result === 'passed') {
        return entry.versionId
            ? `Konfigurace ověřena a uložena jako verze ${shortId(entry.versionId)}`
            : 'Konfigurace ověřena a uložena'
    }
    if (entry.result === 'restored') {
        return 'Změna nebyla funkční, konfigurace byla vrácena do původního stavu'
    }
    return 'Konfigurace neprošla kontrolou'
}

/**
 * Card summarising the automatic configuration check after Codex changed files.
 */
export function verificationCard(entries: ChatEntry[], context: EntryContext): EntryBlock {
    const element = h('div', 'card card-verification')
    const update = (next: ChatEntry[]): void => {
        const entry = entriesOfKind(next, 'verification')[0]
        if (!entry) {
            return
        }
        element.className = `card card-verification is-${entry.result}`
        element.setAttribute('role', entry.result === 'passed' ? 'status' : 'alert')
        const versionId = entry.versionId
        replaceContent(element,
            h('span', 'card-icon', icon(RESULT_ICONS[entry.result])),
            h('div', 'card-body',
                h('strong', 'card-title', headline(entry)),
                entry.message ? h('p', 'card-text', entry.message) : null,
                versionId
                    ? button('link-btn', () => context.openVersion(versionId), ['Zobrazit v historii změn'])
                    : null,
            ),
        )
    }
    update(entries)
    return { element, update }
}
