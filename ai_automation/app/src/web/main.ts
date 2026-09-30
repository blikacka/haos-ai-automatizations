import {
    handleServerEvent,
    handleStreamStatus,
} from './actions/serverEvents'
import { boot } from './actions/session'
import { h } from './dom'
import { EventStream } from './events'
import {
    store,
    type Phase,
} from './state'
import {
    createAppShell,
    createFatalView,
} from './views/appShell'
import { createLoginView } from './views/loginView'

type ScreenFactory = () => HTMLElement

const SCREEN_FACTORIES: Record<Phase, ScreenFactory> = {
    loading: () => h('div', 'center-fill full-screen', h('span', { className: 'spinner', attrs: { role: 'status', 'aria-label': 'Načítám' } })),
    login: createLoginView,
    app: createAppShell,
    fatal: () => createFatalView(() => void boot()),
}

/**
 * Mounts each screen lazily once and toggles visibility by phase (keeps subscriptions single).
 */
function mountScreens(root: HTMLElement): void {
    const screens = new Map<Phase, HTMLElement>()
    store.watch((state) => state.phase, (phase) => {
        let screen = screens.get(phase)
        if (!screen) {
            screen = SCREEN_FACTORIES[phase]()
            screens.set(phase, screen)
            root.appendChild(screen)
        }
        screens.forEach((element, key) => {
            element.hidden = key !== phase
        })
    })
}

function start(): void {
    const root = document.getElementById('app')
    if (!root) {
        return
    }
    root.replaceChildren()
    mountScreens(root)
    const stream = new EventStream({ onEvent: handleServerEvent, onStatus: handleStreamStatus })
    stream.connect()
    void boot()
}

start()
