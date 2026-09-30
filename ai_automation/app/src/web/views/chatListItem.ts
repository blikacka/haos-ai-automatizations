import type { ChatSummary } from '../../shared/api'
import {
    deleteChat,
    openChat,
    renameChat,
} from '../actions/chats'
import {
    button,
    h,
} from '../dom'
import {
    absoluteTime,
    isBusyStatus,
    relativeTime,
} from '../format'
import { icon } from '../icons'

export type ItemMode = 'normal' | 'menu' | 'rename' | 'confirmDelete'

export interface ItemControls {
    mode: ItemMode
    active: boolean
    setMode: (mode: ItemMode) => void
}

const STATUS_LABELS: Record<ChatSummary['status'], string> = {
    idle: '',
    queued: 'Čeká ve frontě',
    running: 'Pracuje',
    verifying: 'Ověřuje',
    waitingForUser: 'Čeká na odpověď',
    error: 'Chyba',
}

function renameForm(chat: ChatSummary, controls: ItemControls): HTMLElement {
    const input = h('input', {
        className: 'input',
        attrs: { type: 'text', value: chat.title, maxlength: 120, 'aria-label': 'Nový název chatu' },
    })
    const save = (): void => {
        controls.setMode('normal')
        if (input.value.trim() && input.value.trim() !== chat.title) {
            void renameChat(chat.id, input.value)
        }
    }
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault()
            save()
        } else if (event.key === 'Escape') {
            event.preventDefault()
            controls.setMode('normal')
        }
    })
    window.requestAnimationFrame(() => {
        input.focus()
        input.select()
    })
    return h('div', 'chat-item-form', input,
        button('icon-btn', save, [icon('check')], { 'aria-label': 'Uložit název' }),
        button('icon-btn', () => controls.setMode('normal'), [icon('close')], { 'aria-label': 'Zrušit přejmenování' }),
    )
}

function deleteConfirm(chat: ChatSummary, controls: ItemControls): HTMLElement {
    const cancel = button('btn btn-ghost btn-small', () => controls.setMode('normal'), ['Zrušit'])
    window.requestAnimationFrame(() => cancel.focus())
    return h('div', { className: 'chat-item-confirm', attrs: { role: 'alertdialog', 'aria-label': 'Potvrzení smazání' } },
        h('span', null, 'Smazat tento chat?'),
        h('div', 'chat-item-confirm-actions',
            cancel,
            button('btn btn-danger btn-small', () => {
                controls.setMode('normal')
                void deleteChat(chat.id)
            }, ['Smazat']),
        ),
    )
}

function itemMenu(controls: ItemControls): HTMLElement {
    const first = button('menu-item', () => controls.setMode('rename'), [icon('edit'), 'Přejmenovat'], { role: 'menuitem' })
    window.requestAnimationFrame(() => first.focus())
    return h('div', {
        className: 'popover-menu',
        attrs: { role: 'menu' },
        on: {
            keydown: (event) => {
                if (event.key === 'Escape') {
                    controls.setMode('normal')
                }
            },
        },
    },
    first,
    button('menu-item is-danger', () => controls.setMode('confirmDelete'), [icon('trash'), 'Smazat'], { role: 'menuitem' }),
    )
}

/**
 * One chat row in the sidebar with status dot, relative time and a rename/delete menu.
 */
export function renderChatItem(chat: ChatSummary, controls: ItemControls): HTMLElement {
    if (controls.mode === 'rename') {
        return h('li', 'chat-item is-editing', renameForm(chat, controls))
    }
    if (controls.mode === 'confirmDelete') {
        return h('li', 'chat-item is-confirming', deleteConfirm(chat, controls))
    }
    const statusLabel = STATUS_LABELS[chat.status]
    const link = button('chat-link', () => void openChat(chat.id), [
        h('span', {
            className: `status-dot is-${chat.status}${isBusyStatus(chat.status) ? ' is-busy' : ''}`,
            attrs: { 'aria-hidden': 'true' },
        }),
        h('span', 'chat-link-text',
            h('span', 'chat-link-title', chat.title || 'Nový chat'),
            h('span', 'chat-link-meta',
                h('time', { attrs: { datetime: chat.updatedAt, title: absoluteTime(chat.updatedAt) } }, relativeTime(chat.updatedAt)),
                statusLabel ? h('span', `chat-link-status is-${chat.status}`, statusLabel) : null,
            ),
        ),
    ], { 'aria-current': controls.active ? 'page' : false })
    const menuToggle = button('icon-btn chat-menu-btn', () => controls.setMode(controls.mode === 'menu' ? 'normal' : 'menu'),
        [icon('dots')], {
            'aria-label': `Možnosti chatu ${chat.title}`,
            'aria-haspopup': 'menu',
            'aria-expanded': String(controls.mode === 'menu'),
        })
    return h('li', `chat-item${controls.active ? ' is-active' : ''}${controls.mode === 'menu' ? ' has-menu' : ''}`,
        link,
        menuToggle,
        controls.mode === 'menu' ? itemMenu(controls) : null,
    )
}
