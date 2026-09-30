import {
    createServer,
    type IncomingMessage,
    type Server,
    type ServerResponse,
} from 'node:http'
import type { AppEnv } from '../config/env.js'
import { logger } from '../util/logger.js'
import type { EventHub } from './eventHub.js'
import {
    isAllowedRemote,
    resolveUser,
} from './identity.js'
import {
    type AccountRouteDeps,
    register as registerAccountRoutes,
} from './routes/accountRoutes.js'
import {
    type ChatRouteDeps,
    register as registerChatRoutes,
} from './routes/chatRoutes.js'
import {
    type HistoryRouteDeps,
    register as registerHistoryRoutes,
} from './routes/historyRoutes.js'
import {
    type MeRouteDeps,
    register as registerMeRoutes,
} from './routes/meRoutes.js'
import {
    type SystemRouteDeps,
    register as registerSystemRoutes,
} from './routes/systemRoutes.js'
import {
    HttpError,
    Router,
    sendError,
    sendJson,
} from './router.js'
import { StaticFiles } from './staticFiles.js'

/** Everything the HTTP layer needs; satisfied by the services built in main.ts. */
export type AppServerDeps = AccountRouteDeps
    & ChatRouteDeps
    & HistoryRouteDeps
    & MeRouteDeps
    & SystemRouteDeps
    & { env: AppEnv, hub: EventHub }

const HEALTH_PATH = '/api/health'
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Security headers applied to every HTTP response. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': [
        "default-src 'self'",
        "connect-src 'self' ws: wss:",
        "img-src 'self' data:",
        "style-src 'self' 'unsafe-inline'",
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "form-action 'none'",
        "object-src 'none'",
    ].join('; '),
    'Cross-Origin-Resource-Policy': 'same-origin',
}

function applySecurityHeaders(res: ServerResponse): void {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        res.setHeader(name, value)
    }
}

function requestPath(req: IncomingMessage): string {
    try {
        return new URL(req.url ?? '/', 'http://localhost').pathname
    } catch {
        return ''
    }
}

function isApiPath(pathname: string): boolean {
    return pathname === '/api' || pathname.startsWith('/api/')
}

/**
 * Build the router with all API routes registered.
 */
export function createRouter(deps: AppServerDeps): Router {
    const router = new Router()
    registerMeRoutes(router, deps)
    registerAccountRoutes(router, deps)
    registerChatRoutes(router, deps)
    registerHistoryRoutes(router, deps)
    registerSystemRoutes(router, deps)
    return router
}

async function handleRequest(
    deps: AppServerDeps,
    router: Router,
    staticFiles: StaticFiles,
    req: IncomingMessage,
    res: ServerResponse,
): Promise<void> {
    applySecurityHeaders(res)
    const pathname = requestPath(req)
    if (pathname === HEALTH_PATH && (req.method === 'GET' || req.method === 'HEAD')) {
        sendJson(res, 200, { ok: true })
        return
    }
    if (!isAllowedRemote(req, deps.env)) {
        throw new HttpError(403, 'Přístup povolen pouze přes Home Assistant')
    }
    if (!isApiPath(pathname)) {
        await staticFiles.serve(req, res)
        return
    }
    if (MUTATING_METHODS.has(req.method ?? '') && req.headers['sec-fetch-site'] === 'cross-site') {
        throw new HttpError(403, 'Požadavek z cizí stránky byl odmítnut')
    }
    const user = resolveUser(req, deps.env)
    if (user === null) {
        throw new HttpError(401, 'Chybí identita uživatele Home Assistant')
    }
    if (!await router.handle(req, res, user)) {
        throw new HttpError(404, 'Neznámý požadavek')
    }
}

/**
 * Create the add-on HTTP server (REST API, static UI, WebSocket events). The caller calls listen().
 */
export function createAppServer(deps: AppServerDeps): Server {
    const router = createRouter(deps)
    const staticFiles = new StaticFiles(deps.env.webDir)
    const server = createServer((req, res) => {
        handleRequest(deps, router, staticFiles, req, res).catch((error: unknown) => sendError(res, error))
    })
    server.on('clientError', (error: Error, socket) => {
        logger.debug('HTTP client error', { error: error.message })
        if (socket.writable) {
            socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
        }
        socket.destroy()
    })
    deps.hub.attach(server, (req) => resolveUser(req, deps.env))
    return server
}
