import type { VersionSummary } from '../../shared/api'
import {
    loadHistory,
    loadMoreHistory,
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
    relativeTime,
    shortId,
    versionKindLabel,
} from '../format'
import { icon } from '../icons'
import { store } from '../state'
import { createHistoryDetail } from './historyDetail'
import { menuButton } from './menuButton'

function versionMeta(version: VersionSummary): HTMLElement {
    return h('span', 'version-meta',
        h('time', { attrs: { datetime: version.createdAt, title: absoluteTime(version.createdAt) } }, relativeTime(version.createdAt)),
        version.userName ? h('span', null, version.userName) : null,
        h('span', null, pluralize(version.filesChanged, 'soubor', 'soubory', 'souborů')),
    )
}

function timelineItem(version: VersionSummary, selected: boolean): HTMLElement {
    const restoredFrom = version.restoredFrom
    return h('li', `timeline-item kind-${version.kind}${selected ? ' is-selected' : ''}${version.isCurrent ? ' is-current' : ''}`,
        h('span', { className: 'timeline-dot', attrs: { 'aria-hidden': 'true' } }),
        h('div', 'timeline-card',
            button('timeline-open', () => void selectVersion(version.id), [
                h('span', 'timeline-badges',
                    h('span', `badge badge-kind kind-${version.kind}`, versionKindLabel(version.kind)),
                    version.isCurrent ? h('span', 'badge badge-current', 'Aktuální') : null,
                    h('code', 'version-id', version.shortId || shortId(version.id)),
                ),
                h('span', 'timeline-title', version.title),
                versionMeta(version),
            ], { 'aria-current': selected ? 'true' : false }),
            restoredFrom
                ? h('p', 'timeline-restored',
                    icon('restore'),
                    'Obnoveno z verze ',
                    button('link-btn', () => void selectVersion(restoredFrom), [shortId(restoredFrom)]),
                )
                : null,
        ),
    )
}

/**
 * "Historie změn" main view: version timeline with pagination and a detail panel.
 */
export function createHistoryView(): HTMLElement {
    const timeline = h('ol', { className: 'timeline', attrs: { 'aria-label': 'Verze konfigurace' } })
    const footer = h('div', 'timeline-footer')
    const listPane = h('div', 'history-list',
        h('p', 'history-intro', 'Každá změna konfigurace se ukládá jako verze. Kteroukoli z nich můžete prohlédnout a obnovit – i obnovení jde vrátit zpět.'),
        timeline,
        footer,
    )
    const detail = createHistoryDetail()
    const layout = h('div', 'history-layout', listPane, detail)

    store.watch((state) => state.history, (history) => {
        layout.classList.toggle('has-detail', history.selectedId !== null)
        if (history.error && !history.versions.length) {
            replaceContent(timeline, h('li', 'card card-error', h('div', 'card-body',
                h('strong', null, 'Historii se nepodařilo načíst'),
                h('p', 'card-text', history.error),
                button('btn btn-secondary btn-small', () => void loadHistory(), ['Zkusit znovu']),
            )))
        } else if (!history.loaded || (history.loading && !history.versions.length)) {
            replaceContent(timeline, h('li', 'center-fill', h('span', { className: 'spinner', attrs: { 'aria-label': 'Načítám historii' } })))
        } else if (!history.versions.length) {
            replaceContent(timeline, h('li', 'chat-list-empty', 'Zatím nebyla uložena žádná verze.'))
        } else {
            replaceContent(timeline, ...history.versions.map((version) => timelineItem(version, version.id === history.selectedId)))
        }
        const more = history.nextCursor
            ? button('btn btn-secondary', () => void loadMoreHistory(), [history.loading ? 'Načítám…' : 'Načíst další'], { disabled: history.loading })
            : null
        replaceContent(footer, more)
    })

    return h('section', { className: 'history-view', attrs: { 'aria-label': 'Historie změn' } },
        h('header', 'topbar',
            menuButton(),
            h('div', 'topbar-title', h('h1', 'chat-title', 'Historie změn')),
            button('btn btn-ghost btn-small', () => void loadHistory(), [icon('restore'), 'Obnovit seznam'], { 'aria-label': 'Znovu načíst historii' }),
        ),
        layout,
    )
}
