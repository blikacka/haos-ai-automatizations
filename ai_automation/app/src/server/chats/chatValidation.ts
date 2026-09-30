import type { AnswerQuestionRequest } from '../../shared/api.js'
import { ChatValidationError } from './chatErrors.js'

const MAX_MESSAGE_LENGTH = 20_000
const OPTION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/

/**
 * Validates an optional model / effort identifier.
 *
 * @param value raw value
 * @param name field name for the error message
 * @returns identifier or null
 * @throws ChatValidationError when malformed
 */
export function validateOption(value: unknown, name: string): string | null {
    if (value === null || value === undefined || value === '') {
        return null
    }
    if (typeof value !== 'string' || !OPTION_ID_PATTERN.test(value)) {
        throw new ChatValidationError(`Neplatná hodnota ${name}`)
    }
    return value
}

/**
 * Validates a chat message text.
 *
 * @param text raw text
 * @returns trimmed text
 * @throws ChatValidationError when empty or too long
 */
export function validateText(text: unknown): string {
    if (typeof text !== 'string' || text.trim() === '') {
        throw new ChatValidationError('Zpráva nesmí být prázdná')
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
        throw new ChatValidationError('Zpráva je příliš dlouhá')
    }
    return text.trim()
}

/**
 * Validates the shape of an answer request.
 *
 * @param request raw request
 * @throws ChatValidationError when malformed
 */
export function validateAnswer(request: AnswerQuestionRequest): void {
    const answers: unknown = request.answers
    if (typeof request.requestId !== 'string' || typeof answers !== 'object' || answers === null
        || Array.isArray(answers)) {
        throw new ChatValidationError('Neplatná odpověď')
    }
}
