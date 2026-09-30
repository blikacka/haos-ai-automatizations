import type { FileDiff } from '../../shared/api'
import { h } from '../dom'
import { fileChangeLabel } from '../format'
import { icon } from '../icons'
import {
    diffStats,
    renderDiff,
} from './diff'

/**
 * Renders a list of changed files; each file expands to its diff (rendered lazily on first open).
 */
export function renderFileList(files: FileDiff[], openPaths: ReadonlySet<string> = new Set()): HTMLElement {
    const list = h('ul', 'file-list')
    files.forEach((file) => {
        const stats = diffStats(file.diff)
        const summary = h('summary', 'file-summary',
            icon('chevronRight', 'file-chevron'),
            icon('file', 'file-icon'),
            h('span', 'file-path', file.path),
            h('span', `badge badge-${file.changeKind}`, fileChangeLabel(file.changeKind)),
            h('span', 'file-stats',
                stats.added ? h('span', 'stat-add', `+${stats.added}`) : null,
                stats.removed ? h('span', 'stat-del', `−${stats.removed}`) : null,
            ),
        )
        const details = h('details', { className: 'file-item', attrs: { 'data-path': file.path } }, summary)
        let rendered = false
        const renderOnce = (): void => {
            if (details.open && !rendered) {
                rendered = true
                details.appendChild(renderDiff(file.diff))
            }
        }
        details.addEventListener('toggle', renderOnce)
        if (openPaths.has(file.path)) {
            details.open = true
            renderOnce()
        }
        list.appendChild(h('li', null, details))
    })
    return list
}

/** Paths of files whose diff is currently expanded inside `container`. */
export function openFilePaths(container: HTMLElement): Set<string> {
    const open = container.querySelectorAll<HTMLDetailsElement>('details.file-item[open]')
    return new Set(Array.from(open, (details) => details.dataset.path ?? ''))
}
