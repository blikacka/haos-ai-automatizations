import type { ServerEvent } from '../shared/api'

const INITIAL_DELAY_MS = 1000
const MAX_DELAY_MS = 15000

export type StreamStatus = 'connecting' | 'open' | 'lost'

export interface EventStreamHandlers {
    onEvent: (event: ServerEvent) => void
    onStatus: (status: StreamStatus, reconnected: boolean) => void
}

function isServerEvent(value: unknown): value is ServerEvent {
    return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
}

/**
 * Builds the WebSocket URL relative to the current page (works behind HA ingress).
 */
export function eventsUrl(): string {
    const url = new URL('api/events', window.location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.hash = ''
    url.search = ''
    return url.toString()
}

/** WebSocket connection to `/api/events` with exponential reconnect backoff. */
export class EventStream {
    private socket: WebSocket | null = null

    private delay = INITIAL_DELAY_MS

    private timer: number | null = null

    private hasConnected = false

    private stopped = false

    constructor(private readonly handlers: EventStreamHandlers) {}

    /** Opens the connection (idempotent). */
    connect(): void {
        if (this.socket || this.stopped) {
            return
        }
        this.handlers.onStatus(this.hasConnected ? 'lost' : 'connecting', false)
        let socket: WebSocket
        try {
            socket = new WebSocket(eventsUrl())
        } catch {
            this.scheduleReconnect()
            return
        }
        this.socket = socket
        socket.addEventListener('open', () => {
            const reconnected = this.hasConnected
            this.hasConnected = true
            this.delay = INITIAL_DELAY_MS
            this.handlers.onStatus('open', reconnected)
        })
        socket.addEventListener('message', (message) => this.handleMessage(message))
        socket.addEventListener('close', () => {
            this.socket = null
            if (!this.stopped) {
                this.handlers.onStatus(this.hasConnected ? 'lost' : 'connecting', false)
                this.scheduleReconnect()
            }
        })
    }

    /** Closes the connection permanently. */
    stop(): void {
        this.stopped = true
        if (this.timer !== null) {
            window.clearTimeout(this.timer)
        }
        this.socket?.close()
    }

    private handleMessage(message: MessageEvent): void {
        if (typeof message.data !== 'string') {
            return
        }
        try {
            const parsed: unknown = JSON.parse(message.data)
            if (isServerEvent(parsed)) {
                this.handlers.onEvent(parsed)
            }
        } catch (error) {
            console.warn('Ignoring malformed server event', error)
        }
    }

    private scheduleReconnect(): void {
        if (this.timer !== null) {
            return
        }
        const jitter = Math.random() * 300
        this.timer = window.setTimeout(() => {
            this.timer = null
            this.connect()
        }, this.delay + jitter)
        this.delay = Math.min(this.delay * 2, MAX_DELAY_MS)
    }
}
