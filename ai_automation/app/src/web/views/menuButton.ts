import { button } from '../dom'
import { icon } from '../icons'
import { store } from '../state'

/**
 * Hamburger button that opens the sidebar drawer on narrow screens.
 */
export function menuButton(): HTMLButtonElement {
    const element = button('icon-btn menu-btn', () => store.set({ drawerOpen: true }), [icon('menu')], {
        'aria-label': 'Otevřít seznam chatů',
        'aria-controls': 'sidebar',
    })
    store.watch((state) => state.drawerOpen, (open) => element.setAttribute('aria-expanded', String(open)))
    return element
}
