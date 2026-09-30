import type { AccountState } from '../../shared/api'
import {
    cancelLogin,
    startLogin,
} from '../actions/session'
import {
    button,
    h,
    replaceContent,
} from '../dom'
import { icon } from '../icons'
import { robotMascot } from '../robot'
import { store } from '../state'
import { copyText } from '../util/clipboard'
import {
    alternativeLogin,
    browserPendingContent,
} from './loginBrowser'
import { safeHttpUrl } from '../util/url'

type PendingAccount = Extract<AccountState, { status: 'pendingLogin' }>

const COPY_RESET_MS = 2000

function loggedOutContent(busy: boolean): Node[] {
    return [
        h('h1', 'login-title', 'Připojte svůj účet ChatGPT'),
        h('p', 'login-lead', 'AI automatizace pracuje přes váš vlastní účet ChatGPT. Každý uživatel Home Assistantu se přihlašuje zvlášť a heslo se sem nikdy nezadává – přihlásíte se přímo na stránce OpenAI.'),
        button('btn btn-primary btn-large', () => void startLogin(), [
            busy ? h('span', { className: 'spinner spinner-small', attrs: { 'aria-hidden': 'true' } }) : icon('user'),
            busy ? 'Připravuji přihlášení…' : 'Přihlásit se přes ChatGPT',
        ], { disabled: busy }),
        alternativeLogin('browser'),
    ]
}

function codeBox(userCode: string): HTMLElement {
    const label = h('span', null, 'Kopírovat')
    const copy = button('btn btn-secondary btn-small', () => {
        void copyText(userCode).then((copied) => {
            label.textContent = copied ? 'Zkopírováno' : 'Zkopírujte ručně'
            window.setTimeout(() => {
                label.textContent = 'Kopírovat'
            }, COPY_RESET_MS)
        })
    }, [icon('copy'), label], { 'aria-label': 'Kopírovat kód' })
    return h('div', 'login-code-box', h('code', { className: 'login-code', attrs: { 'aria-label': `Kód ${userCode.split('').join(' ')}` } }, userCode), copy)
}

function pendingContent(account: PendingAccount): Node[] {
    const href = safeHttpUrl(account.verificationUrl)
    const openLink = href
        ? h('a', { className: 'btn btn-primary', attrs: { href, target: '_blank', rel: 'noopener noreferrer' } },
            icon('external'), 'Otevřít přihlašovací stránku')
        : h('code', null, account.verificationUrl)
    return [
        h('h1', 'login-title', 'Dokončete přihlášení'),
        h('ol', 'login-steps',
            h('li', 'login-step',
                h('span', 'step-number', '1'),
                h('div', 'step-body', h('strong', null, 'Otevřete přihlašovací stránku'), h('p', null, 'Otevře se v nové záložce. Přihlaste se tam svým účtem ChatGPT.'), openLink),
            ),
            h('li', 'login-step',
                h('span', 'step-number', '2'),
                h('div', 'step-body', h('strong', null, 'Zadejte tento kód'), codeBox(account.userCode)),
            ),
            h('li', 'login-step is-waiting',
                h('span', 'step-number', h('span', { className: 'spinner spinner-small', attrs: { 'aria-hidden': 'true' } })),
                h('div', 'step-body',
                    h('strong', { attrs: { role: 'status' } }, 'Čekám na potvrzení…'),
                    h('p', null, 'Jakmile přihlášení potvrdíte, tato stránka se sama přepne.'),
                    button('link-btn', () => void cancelLogin(), ['Zrušit přihlášení']),
                ),
            ),
        ),
        alternativeLogin('browser'),
    ]
}

function contentFor(account: AccountState, busy: boolean): Node[] {
    if (account.status === 'pendingLogin') {
        return pendingContent(account)
    }
    if (account.status === 'pendingBrowserLogin') {
        return browserPendingContent(account, busy)
    }
    return loggedOutContent(busy)
}

/**
 * Login screen: ChatGPT device-code flow or browser OAuth flow with pasted callback address.
 */
export function createLoginView(): HTMLElement {
    const card = h('div', 'login-card')
    store.watch((state) => [state.account, state.loginBusy, state.loginError], () => {
        const { account, loginBusy, loginError } = store.get()
        const content = contentFor(account, loginBusy)
        replaceContent(card,
            robotMascot('robot robot-hero', 'Robot AI automatizace'),
            loginError ? h('div', { className: 'card card-error login-error', attrs: { role: 'alert' } },
                h('span', 'card-icon', icon('alert')), h('p', 'card-text', loginError)) : null,
            ...content,
        )
    })
    return h('main', 'login-view', card)
}
