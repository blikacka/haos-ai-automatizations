import {
    button,
    h,
} from '../dom'

type LineKind = 'add' | 'del' | 'ctx' | 'hunk' | 'meta'

interface DiffLine {
    kind: LineKind
    text: string
    oldNumber: number | null
    newNumber: number | null
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/
const HIDDEN_PREFIXES = ['diff --git', 'index ', '--- ', '+++ ', 'new file mode', 'deleted file mode', 'similarity index']
const INITIAL_LINE_LIMIT = 1200

/**
 * Parses a unified diff into typed lines with old/new line numbers.
 */
export function parseUnifiedDiff(diff: string): DiffLine[] {
    const lines: DiffLine[] = []
    let oldLine = 0
    let newLine = 0
    for (const raw of diff.replace(/\r\n?/g, '\n').split('\n')) {
        const hunk = HUNK_HEADER.exec(raw)
        if (hunk) {
            oldLine = Number(hunk[1])
            newLine = Number(hunk[2])
            lines.push({ kind: 'hunk', text: (hunk[3] ?? '').trim() || 'Změněné řádky', oldNumber: null, newNumber: null })
        } else if (HIDDEN_PREFIXES.some((prefix) => raw.startsWith(prefix))) {
            continue
        } else if (raw.startsWith('+')) {
            lines.push({ kind: 'add', text: raw.slice(1), oldNumber: null, newNumber: newLine })
            newLine += 1
        } else if (raw.startsWith('-')) {
            lines.push({ kind: 'del', text: raw.slice(1), oldNumber: oldLine, newNumber: null })
            oldLine += 1
        } else if (raw.startsWith(' ')) {
            lines.push({ kind: 'ctx', text: raw.slice(1), oldNumber: oldLine, newNumber: newLine })
            oldLine += 1
            newLine += 1
        } else if (raw.startsWith('\\') || raw.trim()) {
            lines.push({ kind: 'meta', text: raw.replace(/^\\\s*/, ''), oldNumber: null, newNumber: null })
        }
    }
    return lines
}

const SIGNS: Record<LineKind, string> = { add: '+', del: '−', ctx: ' ', hunk: '', meta: '' }

function lineRow(line: DiffLine): HTMLElement {
    return h('div', `diff-line diff-${line.kind}`,
        h('span', { className: 'diff-num', attrs: { 'aria-hidden': 'true' } }, line.oldNumber === null ? '' : String(line.oldNumber)),
        h('span', { className: 'diff-num', attrs: { 'aria-hidden': 'true' } }, line.newNumber === null ? '' : String(line.newNumber)),
        h('span', { className: 'diff-sign', attrs: { 'aria-hidden': 'true' } }, SIGNS[line.kind]),
        h('span', 'diff-text', line.text || ' '),
    )
}

function appendRows(container: HTMLElement, lines: DiffLine[]): void {
    const fragment = document.createDocumentFragment()
    lines.forEach((line) => fragment.appendChild(lineRow(line)))
    container.appendChild(fragment)
}

/**
 * Renders a coloured unified diff. Very long diffs are truncated with a "show all" button.
 */
export function renderDiff(diff: string): HTMLElement {
    const lines = parseUnifiedDiff(diff)
    if (!lines.length) {
        return h('p', 'diff-empty', 'Bez textových změn (například binární soubor nebo změna oprávnění).')
    }
    const body = h('div', { className: 'diff-body', attrs: { role: 'region', 'aria-label': 'Rozdíl souboru', tabindex: 0 } })
    const wrapper = h('div', 'diff', body)
    appendRows(body, lines.slice(0, INITIAL_LINE_LIMIT))
    if (lines.length > INITIAL_LINE_LIMIT) {
        const more = button('btn btn-ghost btn-small diff-more', () => {
            appendRows(body, lines.slice(INITIAL_LINE_LIMIT))
            more.remove()
        }, [`Zobrazit zbývajících ${lines.length - INITIAL_LINE_LIMIT} řádků`])
        wrapper.appendChild(more)
    }
    return wrapper
}

/** Counts added and removed lines for a compact summary. */
export function diffStats(diff: string): { added: number, removed: number } {
    const lines = parseUnifiedDiff(diff)
    return {
        added: lines.filter((line) => line.kind === 'add').length,
        removed: lines.filter((line) => line.kind === 'del').length,
    }
}
