import type { ChatEntry } from '../../shared/api.js'
import type { QuestionEntry } from './chatEntries.js'

const MAX_ANSWERS_PER_QUESTION = 20
const MAX_ANSWER_LENGTH = 4000

/**
 * Keeps only string answers of known questions, bounded in count and length.
 *
 * @param entry question entry
 * @param answers raw answers from the request
 * @returns answers keyed by question id
 */
export function sanitizeQuestionAnswers(
    entry: QuestionEntry,
    answers: Record<string, unknown>,
): Record<string, string[]> {
    const result: Record<string, string[]> = {}
    for (const question of entry.questions) {
        const values = answers[question.id]
        result[question.id] = Array.isArray(values)
            ? values
                .filter((value): value is string => typeof value === 'string')
                .slice(0, MAX_ANSWERS_PER_QUESTION)
                .map((value) => value.slice(0, MAX_ANSWER_LENGTH))
            : []
    }
    return result
}

/**
 * Finds a question entry that can no longer be delivered to Codex (e.g. after an add-on restart).
 *
 * @param entries chat entries
 * @param requestId request id of the question
 * @returns unanswered question entry or null
 */
export function findUnansweredQuestion(entries: ChatEntry[], requestId: string): QuestionEntry | null {
    const entry = entries.find((candidate) => candidate.kind === 'question' && candidate.requestId === requestId)
    return entry?.kind === 'question' && !entry.answered ? entry : null
}

/**
 * Formats answers of a stale question as a normal user message for a new turn.
 *
 * @param entry question entry
 * @param answers sanitized answers keyed by question id
 * @returns message text
 */
export function formatAnswersAsMessage(entry: QuestionEntry, answers: Record<string, string[]>): string {
    const lines = entry.questions.map((question) => {
        const values = answers[question.id] ?? []
        return `- ${question.question}: ${values.length > 0 ? values.join(', ') : '(bez odpovědi)'}`
    })
    return `Odpovědi na tvé otázky:\n${lines.join('\n')}`
}
