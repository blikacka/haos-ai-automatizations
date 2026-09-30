import { svg } from './dom'

/** Stroke icon paths drawn on a 24x24 grid. */
const ICON_PATHS = {
    plus: 'M12 5v14M5 12h14',
    search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM20 20l-4.2-4.2',
    menu: 'M4 6h16M4 12h16M4 18h16',
    send: 'M12 19V5M6 11l6-6 6 6',
    stop: 'M7 7h10v10H7z',
    check: 'M5 12.5l4.5 4.5L19 7',
    close: 'M6 6l12 12M18 6L6 18',
    chevronRight: 'M9 6l6 6-6 6',
    chevronDown: 'M6 9l6 6 6-6',
    chevronLeft: 'M15 6l-6 6 6 6',
    copy: 'M9 9h10v10H9zM5 15V5h10',
    dots: 'M5 12h.01M12 12h.01M19 12h.01',
    history: 'M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 8v4l3 2',
    chat: 'M4 5h16v11H9l-5 4z',
    logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
    edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
    trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
    file: 'M6 3h8l4 4v14H6zM14 3v4h4',
    terminal: 'M4 5h16v14H4zM8 10l3 2-3 2M13 15h3',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z',
    globe: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
    wrench: 'M15 4a5 5 0 0 0-4.6 6.9L4 17.3V20h2.7l6.4-6.4A5 5 0 0 0 20 9l-3 1-2-2 1-3z',
    bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z',
    list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
    restore: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4',
    alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5',
    external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
    clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7v5l3 2',
    chip: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
    bell: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
    power: 'M12 3v9M7 6a8 8 0 1 0 10 0',
    user: 'M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM4 21c1-4 4.5-6 8-6s7 2 8 6',
} as const

export type IconName = keyof typeof ICON_PATHS

/**
 * Creates a decorative stroke icon (hidden from assistive technology).
 */
export function icon(name: IconName, className = ''): SVGSVGElement {
    return svg('svg', {
        class: `icon ${className}`.trim(),
        viewBox: '0 0 24 24',
        width: 20,
        height: 20,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': name === 'dots' ? 3 : 1.8,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
        focusable: 'false',
    }, svg('path', { d: ICON_PATHS[name] }))
}
