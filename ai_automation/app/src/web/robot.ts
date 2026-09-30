import { svg } from './dom'

/**
 * Draws the friendly robot mascot as inline SVG. Colours come from CSS custom properties.
 */
export function robotMascot(className = 'robot', label: string | null = null): SVGSVGElement {
    const attrs = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }
    return svg('svg', { class: className, viewBox: '0 0 64 64', width: 64, height: 64, ...attrs },
        svg('line', { x1: 32, y1: 5, x2: 32, y2: 13, class: 'robot-line' }),
        svg('circle', { cx: 32, cy: 5, r: 3.2, class: 'robot-accent robot-antenna' }),
        svg('rect', { x: 4, y: 27, width: 6, height: 14, rx: 3, class: 'robot-ear' }),
        svg('rect', { x: 54, y: 27, width: 6, height: 14, rx: 3, class: 'robot-ear' }),
        svg('rect', { x: 9, y: 13, width: 46, height: 40, rx: 14, class: 'robot-head' }),
        svg('rect', { x: 15, y: 21, width: 34, height: 22, rx: 10, class: 'robot-face' }),
        svg('circle', { cx: 25, cy: 31, r: 3.6, class: 'robot-eye' }),
        svg('circle', { cx: 39, cy: 31, r: 3.6, class: 'robot-eye' }),
        svg('path', { d: 'M26 38q6 4 12 0', class: 'robot-mouth' }),
        svg('rect', { x: 24, y: 55, width: 16, height: 5, rx: 2.5, class: 'robot-neck' }),
    )
}
