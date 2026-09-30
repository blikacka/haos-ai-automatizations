import type { ChatEntry } from '../../../shared/api'
import {
    h,
    replaceContent,
} from '../../dom'
import { pluralize } from '../../format'
import { icon } from '../../icons'
import {
    openFilePaths,
    renderFileList,
} from '../fileList'
import {
    entriesOfKind,
    type EntryBlock,
} from './types'

/**
 * Card "Upravené soubory" listing files touched by Codex with expandable diffs.
 */
export function fileChangeCard(entries: ChatEntry[]): EntryBlock {
    const element = h('section', { className: 'card card-files', attrs: { 'aria-label': 'Upravené soubory' } })
    const update = (next: ChatEntry[]): void => {
        const files = entriesOfKind(next, 'fileChange').flatMap((entry) => entry.files)
        const openPaths = openFilePaths(element)
        replaceContent(element,
            h('header', 'card-header',
                icon('file'),
                h('strong', null, 'Upravené soubory'),
                h('span', 'muted', pluralize(files.length, 'soubor', 'soubory', 'souborů')),
            ),
            renderFileList(files, openPaths),
        )
    }
    update(entries)
    return { element, update }
}
