import {
    button,
    h,
} from './dom'
import { icon } from './icons'
import {
    renderInline,
    renderInlineLines,
} from './markdownInline'
import { copyText } from './util/clipboard'

const FENCE_OPEN = /^\s*(`{3,}|~{3,})\s*([\w+-]*)/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const QUOTE = /^\s*>\s?(.*)$/
const BULLET = /^(\s*)[-*+]\s+(.*)$/
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const NESTED_INDENT = 2
const COPY_RESET_MS = 1800

interface ParseResult {
    node: HTMLElement
    next: number
}

function codeBlock(code: string, language: string): HTMLElement {
    const label = h('span', null, 'Kopírovat')
    const copyButton = button('md-copy', () => {
        void copyText(code).then((copied) => {
            label.textContent = copied ? 'Zkopírováno' : 'Nelze zkopírovat'
            window.setTimeout(() => {
                label.textContent = 'Kopírovat'
            }, COPY_RESET_MS)
        })
    }, [icon('copy'), label], { 'aria-label': 'Kopírovat kód' })
    return h('div', 'md-pre',
        h('div', 'md-pre-bar', h('span', 'md-lang', language || 'kód'), copyButton),
        h('pre', null, h('code', null, code)),
    )
}

function parseFence(lines: string[], start: number, fence: string, language: string): ParseResult {
    const body: string[] = []
    let index = start + 1
    while (index < lines.length && !(lines[index] ?? '').trim().startsWith(fence)) {
        body.push(lines[index] ?? '')
        index += 1
    }
    return { node: codeBlock(body.join('\n'), language), next: index + 1 }
}

function parseList(lines: string[], start: number, ordered: boolean): ParseResult {
    const pattern = ordered ? ORDERED : BULLET
    const list = h(ordered ? 'ol' : 'ul', 'md-list')
    const firstNumber = ordered ? Number(ORDERED.exec(lines[start] ?? '')?.[2] ?? '1') : 1
    if (ordered && firstNumber !== 1) {
        list.setAttribute('start', String(firstNumber))
    }
    let index = start
    let current: HTMLLIElement | null = null
    while (index < lines.length) {
        const line = lines[index] ?? ''
        const match = pattern.exec(line)
        if (match) {
            const indent = (match[1] ?? '').length
            const content = ordered ? match[3] ?? '' : match[2] ?? ''
            current = h('li', indent >= NESTED_INDENT ? 'md-nested' : null, ...renderInline(content))
            list.appendChild(current)
        } else if (current && line.trim() && /^\s{2,}\S/.test(line)) {
            current.appendChild(h('br'))
            renderInline(line.trim()).forEach((node) => current?.appendChild(node))
        } else {
            break
        }
        index += 1
    }
    return { node: list, next: index }
}

function splitRow(line: string): string[] {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

function parseTable(lines: string[], start: number): ParseResult {
    const headRow = h('tr', null, ...splitRow(lines[start] ?? '').map((cell) => h('th', null, ...renderInline(cell))))
    const body = h('tbody')
    let index = start + 2
    while (index < lines.length && (lines[index] ?? '').includes('|') && (lines[index] ?? '').trim()) {
        const cells = splitRow(lines[index] ?? '').map((cell) => h('td', null, ...renderInline(cell)))
        body.appendChild(h('tr', null, ...cells))
        index += 1
    }
    const table = h('table', 'md-table', h('thead', null, headRow), body)
    return { node: h('div', 'md-table-wrap', table), next: index }
}

function parseQuote(lines: string[], start: number): ParseResult {
    const content: string[] = []
    let index = start
    while (index < lines.length) {
        const match = QUOTE.exec(lines[index] ?? '')
        if (!match) {
            break
        }
        content.push(match[1] ?? '')
        index += 1
    }
    return { node: h('blockquote', 'md-quote', ...renderInlineLines(content)), next: index }
}

function startsBlock(lines: string[], index: number): boolean {
    const line = lines[index] ?? ''
    const nextLine = lines[index + 1] ?? ''
    return FENCE_OPEN.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line)
        || BULLET.test(line) || ORDERED.test(line) || (line.includes('|') && TABLE_DIVIDER.test(nextLine))
}

function parseParagraph(lines: string[], start: number): ParseResult {
    const content: string[] = [lines[start] ?? '']
    let index = start + 1
    while (index < lines.length && (lines[index] ?? '').trim() && !startsBlock(lines, index)) {
        content.push(lines[index] ?? '')
        index += 1
    }
    return { node: h('p', null, ...renderInlineLines(content)), next: index }
}

function parseBlock(lines: string[], index: number): ParseResult {
    const line = lines[index] ?? ''
    const fence = FENCE_OPEN.exec(line)
    if (fence) {
        return parseFence(lines, index, fence[1] ?? '```', fence[2] ?? '')
    }
    const heading = HEADING.exec(line)
    if (heading) {
        const level = Math.min((heading[1] ?? '#').length + 2, 6)
        const tag = `h${level}` as 'h3' | 'h4' | 'h5' | 'h6'
        return { node: h(tag, 'md-heading', ...renderInline(heading[2] ?? '')), next: index + 1 }
    }
    if (RULE.test(line)) {
        return { node: h('hr'), next: index + 1 }
    }
    if (QUOTE.test(line)) {
        return parseQuote(lines, index)
    }
    if (BULLET.test(line)) {
        return parseList(lines, index, false)
    }
    if (ORDERED.test(line)) {
        return parseList(lines, index, true)
    }
    if (line.includes('|') && TABLE_DIVIDER.test(lines[index + 1] ?? '')) {
        return parseTable(lines, index)
    }
    return parseParagraph(lines, index)
}

/**
 * Renders a safe subset of Markdown into a DOM fragment. No HTML from the source is ever interpreted.
 */
export function renderMarkdown(source: string): DocumentFragment {
    const fragment = document.createDocumentFragment()
    const lines = source.replace(/\r\n?/g, '\n').split('\n')
    let index = 0
    while (index < lines.length) {
        if (!(lines[index] ?? '').trim()) {
            index += 1
            continue
        }
        const result = parseBlock(lines, index)
        fragment.appendChild(result.node)
        index = Math.max(result.next, index + 1)
    }
    return fragment
}
