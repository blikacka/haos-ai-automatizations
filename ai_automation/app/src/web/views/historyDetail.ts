import type { VersionDetail } from '../../shared/api'
import { openChat } from '../actions/chats'
import {
    restoreVersion,
    selectVersion,
} from '../actions/history'
import {
    button,
    h,
    replaceContent,
} from '../dom'
import {
    absoluteTime,
    pluralize,
    shortId,
    versionKindLabel,
} from '../format'
import { icon } from '../icons'
import { store } from '../state'
import { renderFileList } from './fileList'

const AUTO_OPEN_FILES = 3

function restoreArea(detail: VersionDetail, restoring: boolean): HTMLElement {
    if (detail.isCurrent) {
        return h('p', 'detail-current', icon('check'), 'Toto je aktuální stav konfigurace.')
    }
    const restore = button('btn btn-primary', () => void restoreVersion(detail), [
        restoring ? h('span', { className: 'spinner spinner-small', attrs: { 'aria-hidden': 'true' } }) : icon('restore'),
        restoring ? 'Obnovuji…' : 'Obnovit tuto verzi',
    ], { disabled: restoring })
    return h('div', 'detail-actions', restore,
        h('p', 'detail-hint', 'Současný stav se před obnovením uloží, takže tento krok půjde vrátit zpět.'))
}

function renderDetail(detail: VersionDetail, restoring: boolean): Node[] {
    const chatId = detail.chatId
    const restoredFrom = detail.restoredFrom
    const openPaths = detail.files.length <= AUTO_OPEN_FILES
        ? new Set(detail.files.map((file) => file.path))
        : new Set<string>()
    return [
        h('div', 'detail-head',
            h('span', 'timeline-badges',
                h('span', `badge badge-kind kind-${detail.kind}`, versionKindLabel(detail.kind)),
                detail.isCurrent ? h('span', 'badge badge-current', 'Aktuální') : null,
                h('code', 'version-id', detail.shortId || shortId(detail.id)),
            ),
            h('h2', 'detail-title', detail.title),
            h('p', 'version-meta',
                h('time', { attrs: { datetime: detail.createdAt } }, absoluteTime(detail.createdAt)),
                detail.userName ? h('span', null, detail.userName) : null,
                h('span', null, pluralize(detail.filesChanged, 'změněný soubor', 'změněné soubory', 'změněných souborů')),
            ),
            restoredFrom
                ? h('p', 'timeline-restored', icon('restore'), 'Obnoveno z verze ',
                    button('link-btn', () => void selectVersion(restoredFrom), [shortId(restoredFrom)]))
                : null,
            chatId ? button('link-btn', () => void openChat(chatId), [icon('chat'), 'Otevřít chat, ve kterém změna vznikla']) : null,
        ),
        restoreArea(detail, restoring),
        detail.files.length
            ? renderFileList(detail.files, openPaths)
            : h('p', 'diff-empty', 'Tato verze neobsahuje žádné změny souborů.'),
    ]
}

/**
 * Detail panel of the selected version: metadata, per-file diffs and the restore button.
 */
export function createHistoryDetail(): HTMLElement {
    const content = h('div', 'history-detail-content')
    const panel = h('section', { className: 'history-detail', attrs: { 'aria-label': 'Detail verze' } },
        button('btn btn-ghost btn-small detail-back', () => void selectVersion(null), [icon('chevronLeft'), 'Zpět na seznam']),
        content,
    )
    store.watch((state) => [state.history.detail, state.history.detailLoading, state.history.restoring, state.history.selectedId], () => {
        const { detail, detailLoading, restoring, selectedId } = store.get().history
        if (detailLoading) {
            replaceContent(content, h('div', 'center-fill', h('span', { className: 'spinner', attrs: { 'aria-label': 'Načítám verzi' } })))
        } else if (detail && detail.id === selectedId) {
            replaceContent(content, ...renderDetail(detail, restoring))
        } else {
            replaceContent(content, h('div', 'detail-placeholder', icon('history'), h('p', null, 'Vyberte verzi vlevo a uvidíte, co se v ní změnilo.')))
        }
    })
    return panel
}
