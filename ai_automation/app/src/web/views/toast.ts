import {
    button,
    h,
} from '../dom'
import {
    icon,
    type IconName,
} from '../icons'

export type ToastKind = 'success' | 'error' | 'warning' | 'info'

export interface ToastAction {
    label: string
    run: () => void
}

export interface ToastOptions {
    kind: ToastKind
    title: string
    message?: string
    action?: ToastAction
    durationMs?: number
}

const DEFAULT_DURATION_MS = 6000
const ACTION_DURATION_MS = 15000
const LEAVE_ANIMATION_MS = 200

const KIND_ICONS: Record<ToastKind, IconName> = {
    success: 'check',
    error: 'alert',
    warning: 'alert',
    info: 'bell',
}

let region: HTMLElement | null = null

function toastRegion(): HTMLElement {
    if (!region) {
        region = h('div', { className: 'toast-region', attrs: { 'aria-live': 'polite', 'aria-relevant': 'additions' } })
        document.body.appendChild(region)
    }
    return region
}

function dismiss(toast: HTMLElement): void {
    if (toast.classList.contains('is-leaving')) {
        return
    }
    toast.classList.add('is-leaving')
    window.setTimeout(() => toast.remove(), LEAVE_ANIMATION_MS)
}

/**
 * Shows a toast notification in the bottom-right corner. It hides itself after a while.
 */
export function showToast(options: ToastOptions): void {
    const toast = h('div', { className: `toast toast-${options.kind}`, attrs: { role: options.kind === 'error' ? 'alert' : 'status' } })
    const actionButton = options.action
        ? button('btn btn-small btn-primary', () => {
            options.action?.run()
            dismiss(toast)
        }, [options.action.label])
        : null
    toast.append(
        h('span', 'toast-icon', icon(KIND_ICONS[options.kind])),
        h('div', 'toast-body',
            h('strong', 'toast-title', options.title),
            options.message ? h('p', 'toast-message', options.message) : null,
            actionButton,
        ),
        button('icon-btn toast-close', () => dismiss(toast), [icon('close')], { 'aria-label': 'Zavřít oznámení' }),
    )
    toastRegion().appendChild(toast)
    const duration = options.durationMs ?? (options.action ? ACTION_DURATION_MS : DEFAULT_DURATION_MS)
    let timer = window.setTimeout(() => dismiss(toast), duration)
    toast.addEventListener('mouseenter', () => window.clearTimeout(timer))
    toast.addEventListener('mouseleave', () => {
        timer = window.setTimeout(() => dismiss(toast), DEFAULT_DURATION_MS)
    })
}

/** Shortcut for an error toast. */
export function showError(title: string, message: string): void {
    showToast({ kind: 'error', title, message })
}
