import {
    button,
    h,
    type Child,
} from '../dom'

export interface ConfirmOptions {
    title: string
    body: Child[]
    confirmLabel: string
    cancelLabel?: string
    tone?: 'primary' | 'danger'
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

function trapFocus(dialog: HTMLElement, event: KeyboardEvent): void {
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) {
        return
    }
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
    }
}

/**
 * Opens an accessible confirmation dialog. Resolves true when the user confirms.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return new Promise((resolve) => {
        const titleId = `modal-title-${Date.now()}`
        let settled = false
        const close = (result: boolean): void => {
            if (settled) {
                return
            }
            settled = true
            backdrop.classList.add('is-leaving')
            window.setTimeout(() => backdrop.remove(), 150)
            previousFocus?.focus()
            resolve(result)
        }
        const confirmButton = button(`btn ${options.tone === 'danger' ? 'btn-danger' : 'btn-primary'}`,
            () => close(true), [options.confirmLabel])
        const cancelButton = button('btn btn-ghost', () => close(false), [options.cancelLabel ?? 'Zrušit'])
        const dialog = h('div', {
            className: 'modal',
            attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
            on: {
                keydown: (event) => {
                    if (event.key === 'Escape') {
                        event.preventDefault()
                        close(false)
                    } else if (event.key === 'Tab') {
                        trapFocus(dialog, event)
                    }
                },
            },
        },
        h('h2', { className: 'modal-title', attrs: { id: titleId } }, options.title),
        h('div', 'modal-body', ...options.body.map((child) => (typeof child === 'string' ? h('p', null, child) : child))),
        h('div', 'modal-actions', cancelButton, confirmButton),
        )
        const backdrop = h('div', {
            className: 'modal-backdrop',
            on: {
                mousedown: (event) => {
                    if (event.target === backdrop) {
                        close(false)
                    }
                },
            },
        }, dialog)
        document.body.appendChild(backdrop)
        confirmButton.focus()
    })
}
