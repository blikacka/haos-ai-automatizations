import { renameChat } from '../actions/chats'
import {
    button,
    h,
    replaceContent,
} from '../dom'
import { icon } from '../icons'
import { store } from '../state'
import { menuButton } from './menuButton'
import { createPickers } from './pickers'

const DRAFT_TITLE = 'Nový chat'

/**
 * Chat top bar: drawer button, editable title and model / reasoning pickers.
 */
export function createChatHeader(): HTMLElement {
    const titleSlot = h('div', 'topbar-title')
    let editing = false

    const startEditing = (chatId: string, title: string): void => {
        editing = true
        const input = h('input', {
            className: 'input title-input',
            attrs: { type: 'text', value: title, maxlength: 120, 'aria-label': 'Název chatu' },
        })
        const finish = (save: boolean): void => {
            if (!editing) {
                return
            }
            editing = false
            if (save && input.value.trim() && input.value.trim() !== title) {
                void renameChat(chatId, input.value)
            }
            renderTitle()
        }
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault()
                finish(true)
            } else if (event.key === 'Escape') {
                event.preventDefault()
                finish(false)
            }
        })
        input.addEventListener('blur', () => finish(true))
        replaceContent(titleSlot, input)
        input.focus()
        input.select()
    }

    const renderTitle = (): void => {
        if (editing) {
            return
        }
        const chat = store.get().activeChat
        if (!chat) {
            replaceContent(titleSlot, h('h1', 'chat-title', DRAFT_TITLE))
            return
        }
        replaceContent(titleSlot, button('chat-title-btn', () => startEditing(chat.id, chat.title), [
            h('h1', 'chat-title', chat.title || DRAFT_TITLE),
            icon('edit', 'chat-title-edit'),
        ], { title: 'Přejmenovat chat', 'aria-label': `Přejmenovat chat ${chat.title}` }))
    }

    store.watch((state) => [state.activeChat?.id, state.activeChat?.title], renderTitle)

    return h('header', 'topbar chat-topbar', menuButton(), titleSlot, createPickers())
}
