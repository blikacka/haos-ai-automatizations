/**
 * Minimal DOM helpers. Text is always inserted via text nodes, never as HTML.
 */

export type Child = Node | string | number | null | undefined | false

export type AttrValue = string | number | boolean | null | undefined

export type EventHandlers = {
    [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void
}

export interface Props {
    className?: string
    attrs?: Record<string, AttrValue>
    on?: EventHandlers
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Applies attributes to an element; `false`, `null` and `undefined` values are skipped.
 */
export function setAttrs(element: Element, attrs: Record<string, AttrValue>): void {
    for (const [name, value] of Object.entries(attrs)) {
        if (value === false || value === null || value === undefined) {
            element.removeAttribute(name)
        } else {
            element.setAttribute(name, value === true ? '' : String(value))
        }
    }
}

/**
 * Appends children to a node; strings become text nodes.
 */
export function append(parent: Node, children: Child[]): void {
    for (const child of children) {
        if (child === null || child === undefined || child === false) {
            continue
        }
        parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)))
    }
}

/**
 * Creates an HTML element with optional class, attributes, listeners and children.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Props | string | null = null,
    ...children: Child[]
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag)
    const normalized: Props = typeof props === 'string' ? { className: props } : props ?? {}
    if (normalized.className) {
        element.className = normalized.className
    }
    if (normalized.attrs) {
        setAttrs(element, normalized.attrs)
    }
    if (normalized.on) {
        for (const [eventName, handler] of Object.entries(normalized.on)) {
            element.addEventListener(eventName, handler as EventListener)
        }
    }
    append(element, children)
    return element
}

/**
 * Creates an SVG element with attributes.
 */
export function svg<K extends keyof SVGElementTagNameMap>(
    tag: K,
    attrs: Record<string, AttrValue> = {},
    ...children: SVGElement[]
): SVGElementTagNameMap[K] {
    const element = document.createElementNS(SVG_NS, tag)
    setAttrs(element, attrs)
    children.forEach((child) => element.appendChild(child))
    return element
}

/**
 * Replaces all children of a node.
 */
export function replaceContent(parent: Element, ...children: Child[]): void {
    parent.replaceChildren()
    append(parent, children)
}

/**
 * Creates a `<button type="button">` with a click handler.
 */
export function button(
    className: string,
    onClick: (event: MouseEvent) => void,
    children: Child[],
    attrs: Record<string, AttrValue> = {},
): HTMLButtonElement {
    return h('button', { className, attrs: { type: 'button', ...attrs }, on: { click: onClick } }, ...children)
}
