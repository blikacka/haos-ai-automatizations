import type { AccountState } from '../../shared/api'
import {
    cancelLogin,
    completeBrowserLogin,
    startLogin,
} from '../actions/session'
import {
    button,
    h,
} from '../dom'
import { icon } from '../icons'
import { safeHttpUrl } from '../util/url'

type BrowserPendingAccount = Extract<AccountState, { status: 'pendingBrowserLogin' }>

const CALLBACK_EXAMPLE = 'http://localhost:1455/auth/callback?code=…'

function step(number: string, ...body: (Node | string)[]): HTMLElement {
    return h('li', 'login-step', h('span', 'step-number', number), h('div', 'step-body', ...body))
}

function callbackForm(busy: boolean): HTMLElement {
    const input = h('input', {
        className: 'input login-callback-input',
        attrs: {
            type: 'url',
            placeholder: CALLBACK_EXAMPLE,
            autocomplete: 'off',
            spellcheck: 'false',
            'aria-label': 'Adresa z adresního řádku prohlížeče',
            required: true,
        },
    })
    const submit = button('btn btn-primary', () => undefined, [
        busy ? h('span', { className: 'spinner spinner-small', attrs: { 'aria-hidden': 'true' } }) : icon('check'),
        busy ? 'Dokončuji přihlášení…' : 'Dokončit přihlášení',
    ], { type: 'submit', disabled: busy })
    return h('form', {
        className: 'login-callback-form',
        on: {
            submit: (event: Event) => {
                event.preventDefault()
                const value = input.value.trim()
                if (value !== '') {
                    void completeBrowserLogin(value)
                }
            },
        },
    }, input, submit)
}

/**
 * Steps of the browser (OAuth) login: open the OpenAI page, then paste back the final localhost address.
 *
 * @param account pending browser login
 * @param busy whether the callback is being submitted
 * @returns step list nodes
 */
export function browserPendingContent(account: BrowserPendingAccount, busy: boolean): Node[] {
    const href = safeHttpUrl(account.authUrl)
    const openLink = href
        ? h('a', { className: 'btn btn-primary', attrs: { href, target: '_blank', rel: 'noopener noreferrer' } },
            icon('external'), 'Otevřít přihlašovací stránku')
        : h('code', null, account.authUrl)
    return [
        h('h1', 'login-title', 'Přihlášení přes prohlížeč'),
        h('ol', 'login-steps',
            step('1', h('strong', null, 'Přihlaste se na stránce OpenAI'),
                h('p', null, 'Otevře se v nové záložce. Přihlaste se svým účtem ChatGPT a potvrďte přístup pro Codex.'),
                openLink),
            step('2', h('strong', null, 'Zkopírujte adresu z adresního řádku'),
                h('p', null, 'Po přihlášení prohlížeč zobrazí chybu „Nelze se připojit“ na adrese localhost – to je v pořádku. '
                    + 'Zkopírujte celou adresu z adresního řádku té záložky. Začíná takto:'),
                h('code', 'login-inline-code', 'http://localhost:1455/auth/callback?code=…'),
                h('p', null, 'Adresa obsahuje jednorázový kód, platí jen pro toto přihlášení a nikomu ji neposílejte.')),
            step('3', h('strong', null, 'Vložte adresu sem'), callbackForm(busy)),
        ),
        h('div', 'login-alt',
            button('link-btn', () => void cancelLogin(), ['Zrušit přihlášení']),
        ),
    ]
}

/**
 * Link offering the other login method.
 *
 * @param method method the link switches to
 * @returns alternative login hint
 */
export function alternativeLogin(method: 'deviceCode' | 'browser'): HTMLElement {
    const text = method === 'browser'
        ? 'Hlásí stránka OpenAI, že správce nepovolil ověřování kódem zařízení?'
        : 'Chcete se raději přihlásit jednorázovým kódem?'
    const label = method === 'browser' ? 'Přihlásit se přes prohlížeč' : 'Přihlásit se kódem'
    return h('div', 'login-alt', h('span', null, text), button('link-btn', () => void startLogin(method), [label]))
}
