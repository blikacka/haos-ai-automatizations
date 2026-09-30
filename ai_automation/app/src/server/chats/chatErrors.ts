/** Error raised by chat operations, carrying the HTTP status it maps to. */
export class ChatError extends Error {
    /**
     * @param message human readable (Czech) message safe to show to the user
     * @param statusCode HTTP status code
     */
    public constructor(message: string, public readonly statusCode: number) {
        super(message)
        this.name = 'ChatError'
    }
}

/** Chat does not exist (404). */
export class ChatNotFoundError extends ChatError {
    public constructor() {
        super('Chat nebyl nalezen', 404)
        this.name = 'ChatNotFoundError'
    }
}

/** Chat already has a running or queued turn, or no turn to act on (409). */
export class ChatConflictError extends ChatError {
    /**
     * @param message conflict description
     */
    public constructor(message: string) {
        super(message, 409)
        this.name = 'ChatConflictError'
    }
}

/** Request payload is invalid (400). */
export class ChatValidationError extends ChatError {
    /**
     * @param message validation problem
     */
    public constructor(message: string) {
        super(message, 400)
        this.name = 'ChatValidationError'
    }
}
