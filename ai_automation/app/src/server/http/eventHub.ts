import type {
    IncomingMessage,
    Server,
} from 'node:http'
import type { Duplex } from 'node:stream'
import {
    WebSocket,
    WebSocketServer,
} from 'ws'
import type {
    CurrentUser,
    ServerEvent,
} from '../../shared/api.js'
import { logger } from '../util/logger.js'

/** Resolves the HA user of an upgrade request, null when not allowed. */
export type UserResolver = (req: IncomingMessage) => CurrentUser | null

/** Heartbeat interval in milliseconds. */
export const HEARTBEAT_INTERVAL_MS = 25_000

/** Maximum accepted WebSocket frame payload in bytes. */
export const MAX_WS_PAYLOAD = 64 * 1024

const EVENTS_PATH_SUFFIX = '/api/events'

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
    socket.destroy()
}

function upgradePath(req: IncomingMessage): string {
    try {
        return new URL(req.url ?? '/', 'http://localhost').pathname
    } catch {
        return ''
    }
}

/** Pushes ServerEvents to browsers connected on the /api/events WebSocket. */
export class EventHub {
    private readonly clients = new Map<string, Set<WebSocket>>()
    private readonly alive = new WeakMap<WebSocket, boolean>()
    private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD })
    private heartbeat: NodeJS.Timeout | null = null

    /** Number of currently connected sockets (all users). */
    get connectionCount(): number {
        let total = 0
        for (const sockets of this.clients.values()) {
            total += sockets.size
        }
        return total
    }

    /**
     * Send an event to all sockets of one user.
     */
    publish(userId: string, event: ServerEvent): void {
        const sockets = this.clients.get(userId)
        if (sockets === undefined) {
            return
        }
        const payload = JSON.stringify(event)
        for (const socket of sockets) {
            this.sendRaw(socket, payload)
        }
    }

    /**
     * Send an event to every connected socket.
     */
    broadcast(event: ServerEvent): void {
        const payload = JSON.stringify(event)
        for (const sockets of this.clients.values()) {
            for (const socket of sockets) {
                this.sendRaw(socket, payload)
            }
        }
    }

    /**
     * Handle WebSocket upgrades of the HTTP server and start the heartbeat.
     */
    attach(server: Server, resolveUser: UserResolver): void {
        server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
            this.handleUpgrade(req, socket, head, resolveUser)
        })
        server.on('close', () => this.close())
        this.startHeartbeat()
    }

    /** Stop the heartbeat and close all sockets. */
    close(): void {
        if (this.heartbeat !== null) {
            clearInterval(this.heartbeat)
            this.heartbeat = null
        }
        for (const sockets of this.clients.values()) {
            for (const socket of sockets) {
                socket.terminate()
            }
        }
        this.clients.clear()
        this.wss.close()
    }

    private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, resolveUser: UserResolver): void {
        socket.on('error', (error: Error) => logger.debug('Upgrade socket error', { error: error.message }))
        if (!upgradePath(req).endsWith(EVENTS_PATH_SUFFIX)) {
            rejectUpgrade(socket, 404, 'Not Found')
            return
        }
        if (req.headers['sec-fetch-site'] === 'cross-site') {
            rejectUpgrade(socket, 403, 'Forbidden')
            return
        }
        const user = resolveUser(req)
        if (user === null) {
            rejectUpgrade(socket, 401, 'Unauthorized')
            return
        }
        this.wss.handleUpgrade(req, socket, head, (ws: WebSocket) => this.register(user.id, ws))
    }

    private register(userId: string, ws: WebSocket): void {
        const sockets = this.clients.get(userId) ?? new Set<WebSocket>()
        sockets.add(ws)
        this.clients.set(userId, sockets)
        this.alive.set(ws, true)
        ws.on('pong', () => this.alive.set(ws, true))
        ws.on('message', () => undefined)
        ws.on('error', (error: Error) => logger.debug('WebSocket error', { error: error.message }))
        ws.on('close', () => this.unregister(userId, ws))
        logger.debug('WebSocket client connected', { connections: this.connectionCount })
    }

    private unregister(userId: string, ws: WebSocket): void {
        const sockets = this.clients.get(userId)
        if (sockets === undefined) {
            return
        }
        sockets.delete(ws)
        if (sockets.size === 0) {
            this.clients.delete(userId)
        }
    }

    private sendRaw(socket: WebSocket, payload: string): void {
        if (socket.readyState !== WebSocket.OPEN) {
            return
        }
        socket.send(payload, (error?: Error | null) => {
            if (error !== undefined && error !== null) {
                logger.debug('WebSocket send failed', { error: error.message })
            }
        })
    }

    private startHeartbeat(): void {
        if (this.heartbeat !== null) {
            return
        }
        this.heartbeat = setInterval(() => this.checkAlive(), HEARTBEAT_INTERVAL_MS)
        this.heartbeat.unref()
    }

    private checkAlive(): void {
        for (const sockets of this.clients.values()) {
            for (const socket of sockets) {
                if (this.alive.get(socket) !== true) {
                    socket.terminate()
                    continue
                }
                this.alive.set(socket, false)
                socket.ping()
            }
        }
    }
}
