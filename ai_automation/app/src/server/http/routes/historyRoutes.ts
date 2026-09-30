import type {
    RestoreResult,
    ServerEvent,
    VersionDetail,
    VersionListResponse,
} from '../../../shared/api.js'
import { HistoryError } from '../../history/configHistory.js'
import {
    HttpError,
    type Router,
} from '../router.js'
import { queryInteger } from '../validation.js'

const DEFAULT_PAGE_SIZE = 30
const MAX_PAGE_SIZE = 200
const COMMIT_ID_PATTERN = /^[0-9a-f]{7,40}$/

/** Subset of ConfigHistory used by the history routes. */
export interface HistoryPort {
    list(limit: number, cursor: string | null): Promise<VersionListResponse>
    detail(versionId: string): Promise<VersionDetail>
}

/** Subset of RestoreService used by the history routes. */
export interface RestorePort {
    restore(versionId: string, userName: string): Promise<RestoreResult>
}

/** Dependencies of the history routes. */
export interface HistoryRouteDeps {
    history: HistoryPort
    restore: RestorePort
    runner: { isBusy(): boolean }
    hub: { broadcast(event: ServerEvent): void }
}

function parseCursor(raw: string | null): string | null {
    if (raw === null || raw === '') {
        return null
    }
    if (!COMMIT_ID_PATTERN.test(raw)) {
        throw new HttpError(400, 'Neplatný kurzor')
    }
    return raw
}

/**
 * Run a history operation, exposing HistoryError (invalid / unknown version) as a client error.
 */
async function withHistoryErrors<T>(operation: () => Promise<T>): Promise<T> {
    try {
        return await operation()
    } catch (error) {
        if (error instanceof HistoryError) {
            throw new HttpError(error.status, error.message)
        }
        throw error
    }
}

/**
 * Register configuration version history routes.
 */
export function register(router: Router, deps: HistoryRouteDeps): void {
    router.add('GET', '/api/history', async ({ query }) => {
        const limit = queryInteger(query.get('limit'), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE)
        return deps.history.list(limit, parseCursor(query.get('cursor')))
    })

    router.add('GET', '/api/history/:sha', async ({ params }) => (
        withHistoryErrors(() => deps.history.detail(params.sha ?? ''))
    ))

    router.add('POST', '/api/history/:sha/restore', async ({ params, user }) => {
        if (deps.runner.isBusy()) {
            throw new HttpError(409, 'AI právě upravuje konfiguraci, zkuste obnovení za chvíli')
        }
        const userName = user.displayName || user.name
        const result = await withHistoryErrors(() => deps.restore.restore(params.sha ?? '', userName))
        deps.hub.broadcast({ type: 'history.updated' })
        return result
    })
}
