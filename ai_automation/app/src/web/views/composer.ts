import type { ChatStatus } from '../../shared/api'
import {
    button,
    h,
} from '../dom'
import {
    chatStatusText,
    isBusyStatus,
} from '../format'
import { icon } from '../icons'

export interface ComposerOptions {
    onSend: (text: string) => Promise<boolean>
    onStop: () => void
}

export interface Composer {
    element: HTMLElement
    setText: (text: string) => void
    focus: () => void
    setState: (status: ChatStatus | null, sending: boolean) => void
}

const MAX_HEIGHT_RATIO = 0.4

/**
 * Message composer: autosizing textarea, Enter sends, Shift+Enter adds a new line,
 * stop button and status text while Codex is working.
 */
export function createComposer(options: ComposerOptions): Composer {
    let status: ChatStatus | null = null
    let sending = false

    const textarea = h('textarea', {
        className: 'composer-input',
        attrs: {
            rows: 1,
            placeholder: 'Napište, co mám udělat…',
            'aria-label': 'Zpráva pro Codex',
            enterkeyhint: 'send',
        },
    })
    const statusText = h('span', 'composer-status-text')
    const statusLine = h('div', { className: 'composer-status', attrs: { 'aria-live': 'polite' } },
        h('span', { className: 'spinner spinner-small', attrs: { 'aria-hidden': 'true' } }),
        statusText,
    )
    const sendButton = button('composer-send', () => void send(), [icon('send')], { 'aria-label': 'Odeslat zprávu', title: 'Odeslat (Enter)' })
    const stopButton = button('btn btn-secondary composer-stop', () => options.onStop(), [icon('stop'), h('span', 'composer-stop-label', 'Zastavit')], { 'aria-label': 'Zastavit práci' })

    const canSend = (): boolean => !sending && !isBusyStatus(status) && textarea.value.trim().length > 0

    const autosize = (): void => {
        textarea.style.height = 'auto'
        const maxHeight = Math.round(window.innerHeight * MAX_HEIGHT_RATIO)
        textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
    }

    const refresh = (): void => {
        const busy = isBusyStatus(status)
        sendButton.disabled = !canSend()
        stopButton.hidden = !(status === 'running' || status === 'queued')
        const text = sending ? 'Odesílám…' : chatStatusText(status)
        statusLine.hidden = !text
        statusLine.classList.toggle('is-busy', busy || sending)
        statusText.textContent = text ?? ''
    }

    const send = async (): Promise<void> => {
        if (!canSend()) {
            return
        }
        const text = textarea.value.trim()
        textarea.value = ''
        autosize()
        refresh()
        const ok = await options.onSend(text)
        if (!ok && !textarea.value) {
            textarea.value = text
            autosize()
        }
        refresh()
    }

    textarea.addEventListener('input', () => {
        autosize()
        refresh()
    })
    textarea.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault()
            void send()
        }
    })

    const element = h('div', 'composer',
        statusLine,
        h('div', 'composer-box', textarea, stopButton, sendButton),
        h('p', 'composer-hint', 'Enter odešle, Shift+Enter přidá nový řádek. Na doplňující otázky odpovídejte zde.'),
    )
    refresh()

    return {
        element,
        setText: (text: string) => {
            textarea.value = text
            autosize()
            refresh()
        },
        focus: () => textarea.focus(),
        setState: (nextStatus, nextSending) => {
            status = nextStatus
            sending = nextSending
            refresh()
        },
    }
}
