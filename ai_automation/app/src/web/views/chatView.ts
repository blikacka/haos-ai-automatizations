import {
    answerQuestion,
    interruptChat,
    sendMessage,
} from '../actions/chats'
import { openVersion } from '../actions/history'
import {
    h,
    replaceContent,
} from '../dom'
import { store } from '../state'
import { createChatHeader } from './chatHeader'
import { createComposer } from './composer'
import { renderEmptyState } from './emptyState'
import { createMessageList } from './messageList'

const BOTTOM_THRESHOLD_PX = 80

function isNearBottom(scroller: HTMLElement): boolean {
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < BOTTOM_THRESHOLD_PX
}

/**
 * Main chat area: header, incrementally rendered message list and composer.
 */
export function createChatView(): HTMLElement {
    const composer = createComposer({
        onSend: sendMessage,
        onStop: () => void interruptChat(),
    })
    const messageList = createMessageList({ openVersion, answer: answerQuestion })
    const column = h('div', 'chat-column')
    const scroller = h('div', { className: 'chat-scroll', attrs: { role: 'log', 'aria-live': 'off', 'aria-label': 'Konverzace', tabindex: '-1' } }, column)
    const emptyState = renderEmptyState((text) => {
        composer.setText(text)
        composer.focus()
    }, store.get().user?.displayName ?? null)
    const loading = h('div', 'center-fill', h('span', { className: 'spinner', attrs: { role: 'status', 'aria-label': 'Načítám chat' } }))

    let renderedChatId: string | null | undefined
    let frame: number | null = null

    const renderNow = (): void => {
        frame = null
        const state = store.get()
        const chat = state.activeChat
        const switched = renderedChatId !== state.activeChatId
        if (switched) {
            messageList.reset()
            renderedChatId = state.activeChatId
        }
        if (state.chatLoading && !chat) {
            replaceContent(column, loading)
            return
        }
        if (!chat || chat.entries.length === 0) {
            replaceContent(column, emptyState)
            return
        }
        const stick = switched || isNearBottom(scroller) || column.firstChild !== messageList.element
        if (column.firstChild !== messageList.element) {
            replaceContent(column, messageList.element)
        }
        messageList.render(chat.entries)
        if (stick) {
            scroller.scrollTop = scroller.scrollHeight
        }
    }

    const scheduleRender = (): void => {
        if (frame === null) {
            frame = window.requestAnimationFrame(renderNow)
        }
    }

    store.watch((state) => [state.activeChatId, state.activeChat?.entries, state.chatLoading], scheduleRender)
    store.watch((state) => [state.activeChat?.status ?? null, state.sending], () => {
        const state = store.get()
        composer.setState(state.activeChat?.status ?? null, state.sending)
    })
    store.watch((state) => state.activeChatId, () => {
        if (window.matchMedia('(pointer: fine)').matches) {
            composer.focus()
        }
    })

    return h('section', { className: 'chat-view', attrs: { 'aria-label': 'Chat' } },
        createChatHeader(),
        scroller,
        h('div', 'composer-wrap', composer.element),
    )
}
