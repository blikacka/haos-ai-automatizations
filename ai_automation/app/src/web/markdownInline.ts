import { h } from './dom'
import { safeHttpUrl } from './util/url'

/*
 * Inline tokens: code spans, bold, italic, links and bare URLs.
 * Groups: 1-2 code, 3 bold(**), 4 bold(__), 5 italic(*), 6 italic(_), 7-8 link, 9 bare url.
 */
const INLINE_PATTERN = new RegExp([
    '(`+)([^`]|[^`][\\s\\S]*?[^`])\\1(?!`)',
    '\\*\\*(?=\\S)([\\s\\S]*?\\S)\\*\\*',
    '__(?=\\S)([\\s\\S]*?\\S)__',
    '\\*(?=[^\\s*])([^*]*?[^\\s*])\\*',
    '(?<![\\w])_(?=\\S)([^_]*?\\S)_(?![\\w])',
    '\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)',
    '(https?:\\/\\/[^\\s<>()]*[^\\s<>().,;:!?\'"])',
].join('|'), 'g')

function link(label: Node[], rawUrl: string, fallbackText: string): Node {
    const href = safeHttpUrl(rawUrl)
    if (!href) {
        return document.createTextNode(fallbackText)
    }
    const anchor = h('a', { attrs: { href, target: '_blank', rel: 'noopener noreferrer' } })
    label.forEach((node) => anchor.appendChild(node))
    return anchor
}

function tokenToNode(match: RegExpExecArray): Node {
    const [whole, , code, boldStars, boldUnderscore, italicStar, italicUnderscore, linkText, linkUrl, bareUrl] = match
    if (code !== undefined) {
        return h('code', 'md-code', code.trim().length ? code.replace(/^ (.*) $/s, '$1') : code)
    }
    const bold = boldStars ?? boldUnderscore
    if (bold !== undefined) {
        return withChildren(h('strong'), renderInline(bold))
    }
    const italic = italicStar ?? italicUnderscore
    if (italic !== undefined) {
        return withChildren(h('em'), renderInline(italic))
    }
    if (linkText !== undefined && linkUrl !== undefined) {
        return link(renderInline(linkText), linkUrl, whole)
    }
    if (bareUrl !== undefined) {
        return link([document.createTextNode(bareUrl)], bareUrl, bareUrl)
    }
    return document.createTextNode(whole)
}

function withChildren(element: HTMLElement, children: Node[]): HTMLElement {
    children.forEach((child) => element.appendChild(child))
    return element
}

/**
 * Renders inline markdown to DOM nodes. Every piece of text becomes a text node (no HTML parsing).
 */
export function renderInline(text: string): Node[] {
    const nodes: Node[] = []
    const pattern = new RegExp(INLINE_PATTERN.source, 'g')
    let lastIndex = 0
    let match = pattern.exec(text)
    while (match) {
        if (match.index > lastIndex) {
            nodes.push(document.createTextNode(text.slice(lastIndex, match.index)))
        }
        nodes.push(tokenToNode(match))
        lastIndex = pattern.lastIndex
        match = pattern.exec(text)
    }
    if (lastIndex < text.length) {
        nodes.push(document.createTextNode(text.slice(lastIndex)))
    }
    return nodes
}

/**
 * Renders inline markdown with hard line breaks preserved.
 */
export function renderInlineLines(lines: string[]): Node[] {
    const nodes: Node[] = []
    lines.forEach((line, index) => {
        if (index > 0) {
            nodes.push(h('br'))
        }
        nodes.push(...renderInline(line))
    })
    return nodes
}
