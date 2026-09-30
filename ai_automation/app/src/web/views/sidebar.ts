import type { ChatSummary } from '../../shared/api'
import { newChat } from '../actions/chats'
import { showHistory } from '../actions/history'
import { logout } from '../actions/session'
import {
    button,
    h,
    replaceContent,
} from '../dom'
import {
    dayGroup,
    type DayGroup,
} from '../format'
import { icon } from '../icons'
import { robotMascot } from '../robot'
import { store } from '../state'
import {
    renderChatItem,
    type ItemMode,
} from './chatListItem'

const GROUP_LABELS: Record<DayGroup, string> = { today: 'Dnes', yesterday: 'Včera', older: 'Starší' }
const TIME_REFRESH_MS = 60_000
const GROUP_ORDER: DayGroup[] = ['today', 'yesterday', 'older']

interface ItemState {
    chatId: string | null
    mode: ItemMode
}

function matches(chat: ChatSummary, search: string): boolean {
    return !search || chat.title.toLocaleLowerCase('cs').includes(search.toLocaleLowerCase('cs'))
}

function accountFooter(): HTMLElement {
    const footer = h('div', 'sidebar-account')
    store.watch((state) => [state.account, state.user, state.addonVersion], () => {
        const { account, user, addonVersion } = store.get()
        const email = account.status === 'loggedIn' ? account.email : null
        replaceContent(footer,
            h('span', 'account-avatar', icon('user')),
            h('span', 'account-text',
                h('span', 'account-name', user?.displayName || user?.name || 'Uživatel'),
                h('span', 'account-email', email ?? 'Účet ChatGPT'),
            ),
            button('icon-btn', () => void logout(), [icon('logout')], {
                'aria-label': 'Odhlásit se z ChatGPT',
                title: `Odhlásit${addonVersion ? ` · verze doplňku ${addonVersion}` : ''}`,
            }),
        )
    })
    return footer
}

function viewTabs(): HTMLElement {
    const chatsTab = button('tab', () => store.set({ view: 'chats', drawerOpen: false }), [icon('chat'), 'Chaty'])
    const historyTab = button('tab', showHistory, [icon('history'), 'Historie změn'])
    store.watch((state) => state.view, (view) => {
        chatsTab.setAttribute('aria-pressed', String(view === 'chats'))
        historyTab.setAttribute('aria-pressed', String(view === 'history'))
    })
    return h('div', { className: 'tabs', attrs: { role: 'group', 'aria-label': 'Zobrazení' } }, chatsTab, historyTab)
}

/**
 * Left sidebar: brand, new chat, search, grouped chat list, view tabs and account.
 */
export function createSidebar(): HTMLElement {
    const itemState: ItemState = { chatId: null, mode: 'normal' }
    const list = h('nav', { className: 'chat-list', attrs: { 'aria-label': 'Seznam chatů' } })

    const renderList = (): void => {
        const { chats, chatsLoaded, search, activeChatId, view } = store.get()
        const visible = chats.filter((chat) => matches(chat, search))
        if (!chatsLoaded) {
            replaceContent(list, h('div', 'center-fill', h('span', { className: 'spinner spinner-small', attrs: { 'aria-label': 'Načítám' } })))
            return
        }
        if (!visible.length) {
            replaceContent(list, h('p', 'chat-list-empty', search ? 'Žádný chat neodpovídá hledání.' : 'Zatím tu nejsou žádné chaty. Začněte tím, že napíšete, co potřebujete.'))
            return
        }
        const now = new Date()
        const sections = GROUP_ORDER.map((group) => {
            const items = visible.filter((chat) => dayGroup(chat.updatedAt, now) === group)
            if (!items.length) {
                return null
            }
            const headingId = `chat-group-${group}`
            return h('section', 'chat-group',
                h('h2', { className: 'chat-group-title', attrs: { id: headingId } }, GROUP_LABELS[group]),
                h('ul', { className: 'chat-group-list', attrs: { 'aria-labelledby': headingId } },
                    ...items.map((chat) => renderChatItem(chat, {
                        mode: itemState.chatId === chat.id ? itemState.mode : 'normal',
                        active: view === 'chats' && chat.id === activeChatId,
                        setMode: (mode) => {
                            itemState.chatId = chat.id
                            itemState.mode = mode
                            renderList()
                        },
                    })),
                ),
            )
        })
        replaceContent(list, ...sections)
    }

    const renderUnlessEditing = (): void => {
        if (itemState.mode !== 'rename' && itemState.mode !== 'confirmDelete') {
            renderList()
        }
    }
    store.watch((state) => [state.chats, state.chatsLoaded, state.search, state.activeChatId, state.view], renderUnlessEditing)
    window.setInterval(renderUnlessEditing, TIME_REFRESH_MS)

    const searchInput = h('input', {
        className: 'input search-input',
        attrs: { type: 'search', placeholder: 'Hledat v chatech', 'aria-label': 'Hledat v chatech' },
        on: { input: () => store.set({ search: searchInput.value }) },
    })
    document.addEventListener('click', (event) => {
        if (itemState.mode === 'menu' && event.target instanceof Node && !list.contains(event.target)) {
            itemState.mode = 'normal'
            renderList()
        }
    })

    return h('aside', { className: 'sidebar', attrs: { id: 'sidebar', 'aria-label': 'Postranní panel' } },
        h('div', 'sidebar-brand',
            robotMascot('robot robot-brand'),
            h('span', 'brand-name', 'AI automatizace'),
            button('icon-btn drawer-close', () => store.set({ drawerOpen: false }), [icon('close')], { 'aria-label': 'Zavřít panel' }),
        ),
        button('btn btn-primary new-chat-btn', newChat, [icon('plus'), 'Nový chat']),
        h('div', 'search-box', icon('search', 'search-icon'), searchInput),
        list,
        viewTabs(),
        accountFooter(),
    )
}
