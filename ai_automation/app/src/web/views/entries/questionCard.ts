import type {
    ChatEntry,
    Question,
} from '../../../shared/api'
import {
    button,
    h,
    replaceContent,
} from '../../dom'
import { icon } from '../../icons'
import {
    entriesOfKind,
    type EntryBlock,
    type EntryContext,
    type EntryOf,
} from './types'

type QuestionEntry = EntryOf<'question'>

function answeredView(entry: QuestionEntry): Node[] {
    return entry.questions.map((question) => h('div', 'question',
        question.header ? h('span', 'question-header', question.header) : null,
        h('p', 'question-text', question.question),
        h('div', 'question-answer',
            icon('check'),
            h('span', null, (entry.answers?.[question.id] ?? []).join(', ') || 'Bez odpovědi'),
        ),
    ))
}

/**
 * Interactive form for a pending question; with a single question an option click submits immediately.
 */
function pendingView(entry: QuestionEntry, context: EntryContext, rerender: () => void): Node[] {
    const selected = new Map<string, string>()
    const single = entry.questions.length === 1
    const controls: HTMLButtonElement[] = []
    let busy = false

    const submit = async (): Promise<void> => {
        if (busy) {
            return
        }
        busy = true
        controls.forEach((control) => {
            control.disabled = true
        })
        const answers: Record<string, string[]> = {}
        selected.forEach((value, questionId) => {
            answers[questionId] = [value]
        })
        const ok = await context.answer(entry.requestId, answers)
        if (!ok) {
            busy = false
            rerender()
        }
    }

    const submitButton = button('btn btn-primary', () => void submit(), ['Odeslat odpovědi'])
    submitButton.disabled = true
    controls.push(submitButton)
    const refreshSubmit = (): void => {
        submitButton.disabled = busy || entry.questions.some((question) => !selected.get(question.id))
    }

    const renderQuestion = (question: Question): HTMLElement => {
        const optionButtons: HTMLButtonElement[] = []
        const choose = (value: string, chosen: HTMLButtonElement | null): void => {
            selected.set(question.id, value)
            optionButtons.forEach((option) => option.setAttribute('aria-pressed', String(option === chosen)))
            refreshSubmit()
            if (single) {
                void submit()
            }
        }
        question.options.forEach((option) => {
            const optionButton = button('option-btn', () => choose(option.label, optionButton), [
                h('span', 'option-label', option.label),
                option.description ? h('span', 'option-desc', option.description) : null,
            ], { 'aria-pressed': 'false' })
            optionButtons.push(optionButton)
            controls.push(optionButton)
        })
        const otherInput = h('input', {
            className: 'input',
            attrs: { type: 'text', placeholder: 'Jiná odpověď', 'aria-label': `Jiná odpověď: ${question.question}` },
        })
        const otherSend = button('btn btn-secondary', () => {
            if (otherInput.value.trim()) {
                choose(otherInput.value.trim(), null)
            }
        }, [single ? 'Odeslat' : 'Použít'])
        otherInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault()
                otherSend.click()
            }
        })
        controls.push(otherSend)
        const allowOther = question.allowOther || question.options.length === 0
        return h('fieldset', 'question',
            h('legend', 'sr-only', question.question),
            question.header ? h('span', 'question-header', question.header) : null,
            h('p', 'question-text', question.question),
            optionButtons.length ? h('div', 'option-list', ...optionButtons) : null,
            allowOther ? h('div', 'question-other', otherInput, otherSend) : null,
        )
    }

    const nodes: Node[] = entry.questions.map(renderQuestion)
    if (!single) {
        nodes.push(h('div', 'question-actions', submitButton))
    }
    return nodes
}

/**
 * Card for `item/tool/requestUserInput` questions from Codex.
 */
export function questionCard(entries: ChatEntry[], context: EntryContext): EntryBlock {
    const element = h('section', { className: 'card card-question', attrs: { 'aria-label': 'Dotaz od Codexu' } })
    let lastAnswered: boolean | null = null
    let current: QuestionEntry | null = null

    const render = (): void => {
        if (!current) {
            return
        }
        element.classList.toggle('is-answered', current.answered)
        replaceContent(element,
            h('header', 'card-header', icon('chat'), h('strong', null, current.answered ? 'Odpověděli jste' : 'Codex potřebuje vaši odpověď')),
            ...(current.answered ? answeredView(current) : pendingView(current, context, render)),
        )
    }
    const update = (next: ChatEntry[]): void => {
        current = entriesOfKind(next, 'question')[0] ?? null
        if (current && current.answered !== lastAnswered) {
            lastAnswered = current.answered
            render()
        }
    }
    update(entries)
    return { element, update }
}
