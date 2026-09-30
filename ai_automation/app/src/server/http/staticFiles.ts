import { createReadStream } from 'node:fs'
import {
    realpath,
    stat,
} from 'node:fs/promises'
import type {
    IncomingMessage,
    ServerResponse,
} from 'node:http'
import path from 'node:path'
import {
    HttpError,
    sendError,
} from './router.js'

const INDEX_FILE = 'index.html'
/** Always revalidate (ETag) so browsers pick up new UI files right after an add-on update. */
const CACHE_CONTROL = 'no-cache'

const CONTENT_TYPES: Readonly<Record<string, string>> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.woff2': 'font/woff2',
}

/** Content type for a file name, application/octet-stream when unknown. */
export function contentTypeFor(fileName: string): string {
    return CONTENT_TYPES[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream'
}

function isInside(root: string, candidate: string): boolean {
    return candidate === root || candidate.startsWith(root + path.sep)
}

function decodePathname(rawUrl: string): string {
    const pathname = new URL(rawUrl, 'http://localhost').pathname
    let decoded: string
    try {
        decoded = decodeURIComponent(pathname)
    } catch {
        throw new HttpError(400, 'Neplatná adresa')
    }
    if (decoded.includes('\0') || decoded.includes('\\')) {
        throw new HttpError(400, 'Neplatná adresa')
    }
    return decoded
}

async function isFile(filePath: string): Promise<boolean> {
    try {
        return (await stat(filePath)).isFile()
    } catch {
        return false
    }
}

/** Serves the built web UI from a directory with SPA index.html fallback and traversal protection. */
export class StaticFiles {
    private readonly root: string
    private realRoot: string | null = null

    /**
     * @param webDir directory with the built frontend (index.html, app.js, ...)
     */
    constructor(webDir: string) {
        this.root = path.resolve(webDir)
    }

    /**
     * Serve a GET/HEAD request; responds 403 for paths escaping the web dir, 404 when nothing to serve.
     */
    async serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
        try {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                res.setHeader('Allow', 'GET, HEAD')
                throw new HttpError(405, 'Metoda není povolena')
            }
            const filePath = await this.resolveFile(req.url ?? '/')
            await this.sendFile(req, res, filePath)
        } catch (error) {
            sendError(res, error)
        }
    }

    /**
     * Map a request URL to an existing file inside the web dir (index.html fallback).
     *
     * @throws HttpError 403 on traversal attempts, 404 when index.html is missing
     */
    async resolveFile(rawUrl: string): Promise<string> {
        const decoded = decodePathname(rawUrl)
        const candidate = path.resolve(this.root, '.' + path.posix.sep + decoded)
        if (!isInside(this.root, candidate)) {
            throw new HttpError(403, 'Přístup odepřen')
        }
        const hidden = path.relative(this.root, candidate).split(path.sep).some((part) => part.startsWith('.'))
        if (!hidden && candidate !== this.root && await isFile(candidate)) {
            return this.ensureRealInside(candidate)
        }
        const indexPath = path.join(this.root, INDEX_FILE)
        if (await isFile(indexPath)) {
            return indexPath
        }
        throw new HttpError(404, 'Soubor nenalezen')
    }

    private async ensureRealInside(filePath: string): Promise<string> {
        this.realRoot ??= await realpath(this.root)
        const real = await realpath(filePath)
        if (!isInside(this.realRoot, real)) {
            throw new HttpError(403, 'Přístup odepřen')
        }
        return real
    }

    private async sendFile(req: IncomingMessage, res: ServerResponse, filePath: string): Promise<void> {
        const info = await stat(filePath)
        const etag = `W/"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`
        res.setHeader('Cache-Control', CACHE_CONTROL)
        res.setHeader('ETag', etag)
        if (req.headers['if-none-match'] === etag) {
            res.statusCode = 304
            res.end()
            return
        }
        res.statusCode = 200
        res.setHeader('Content-Type', contentTypeFor(filePath))
        res.setHeader('Content-Length', info.size)
        if (req.method === 'HEAD') {
            res.end()
            return
        }
        await new Promise<void>((resolve, reject) => {
            const stream = createReadStream(filePath)
            stream.on('error', reject)
            res.on('finish', resolve)
            res.on('close', resolve)
            stream.pipe(res)
        })
    }
}
