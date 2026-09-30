import {
    button,
    h,
} from '../dom'
import { icon } from '../icons'
import { store } from '../state'
import { createChatView } from './chatView'
import { createHistoryView } from './historyView'
import { createSidebar } from './sidebar'

function connectionBanner(): HTMLElement {
    const banner = h('div', { className: 'connection-banner', attrs: { role: 'status' } },
        h('span', { className: 'spinner spinner-small', attrs: { 'aria-hidden': 'true' } }),
        'Spojení ztraceno, obnovuji…',
    )
    store.watch((state) => state.connection, (connection) => {
        banner.hidden = connection !== 'lost'
    })
    return banner
}

/**
 * Logged-in application layout: sidebar (drawer on mobile), connection banner and main view.
 */
export function createAppShell(): HTMLElement {
    const sidebar = createSidebar()
    const chatView = createChatView()
    const historyView = createHistoryView()
    const scrim = button('scrim', () => store.set({ drawerOpen: false }), [], { 'aria-label': 'Zavřít panel', tabindex: '-1' })
    const main = h('main', 'main', connectionBanner(), chatView, historyView)
    const shell = h('div', 'app-shell', sidebar, scrim, main)

    store.watch((state) => state.view, (view) => {
        chatView.hidden = view !== 'chats'
        historyView.hidden = view !== 'history'
    })
    store.watch((state) => state.drawerOpen, (open) => {
        shell.classList.toggle('drawer-open', open)
        if (open) {
            sidebar.querySelector<HTMLElement>('.new-chat-btn')?.focus()
        }
    })
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && store.get().drawerOpen) {
            store.set({ drawerOpen: false })
        }
    })
    return shell
}

/** Full-screen error with retry, shown when the add-on API is unreachable. */
export function createFatalView(onRetry: () => void): HTMLElement {
    const message = h('p', 'login-lead')
    store.watch((state) => state.fatalError, (error) => {
        message.textContent = error ?? ''
    })
    return h('main', 'login-view',
        h('div', 'login-card',
            h('span', 'fatal-icon', icon('alert')),
            h('h1', 'login-title', 'Doplněk teď nereaguje'),
            message,
            button('btn btn-primary', onRetry, [icon('restore'), 'Zkusit znovu']),
        ),
    )
}
