import {
    button,
    h,
} from '../dom'
import {
    icon,
    type IconName,
} from '../icons'
import { robotMascot } from '../robot'

interface ExamplePrompt {
    icon: IconName
    text: string
}

const EXAMPLES: ExamplePrompt[] = [
    { icon: 'clock', text: 'Každou hodinu zapni žárovku v kotelně' },
    { icon: 'chip', text: 'Najdi USB převodník Waveshare Modbus RTU relé a vytvoř z něj přepínače' },
    { icon: 'bell', text: 'Pošli mi notifikaci, když se otevřou vchodové dveře a nikdo není doma' },
    { icon: 'shield', text: 'Zkontroluj, jestli v konfiguraci nejsou chyby' },
]

/**
 * Greeting with example prompts shown in an empty chat.
 */
export function renderEmptyState(onPick: (text: string) => void, userName: string | null): HTMLElement {
    const greeting = userName ? `Dobrý den, ${userName}.` : 'Dobrý den.'
    return h('div', 'empty-state',
        robotMascot('robot robot-hero'),
        h('p', 'empty-greeting', greeting),
        h('h1', 'empty-title', 'Co mám pro vás udělat?'),
        h('p', 'empty-lead', 'Popište vlastními slovy, co má váš Home Assistant dělat. Když si nebudu jistý, zeptám se.'),
        h('div', 'example-grid',
            ...EXAMPLES.map((example) => button('example-card', () => onPick(example.text), [
                h('span', 'example-icon', icon(example.icon)),
                h('span', 'example-text', example.text),
            ])),
        ),
        h('p', 'empty-reassurance', icon('shield'), 'Před každou změnou se automaticky vytvoří záloha a vše se ověří.'),
    )
}
