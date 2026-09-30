import type {
    EffortOption,
    ModelOption,
} from '../../shared/api.js'
import {
    CODEX_METHODS,
    type ModelListResponse,
} from './protocol.js'
import { SHORT_REQUEST_TIMEOUT_MS } from './rpcClient.js'

/** Model lists are cached per user for this time. */
export const MODEL_CACHE_TTL_MS = 10 * 60 * 1000

/** Safety limit of `model/list` pages. */
const MAX_PAGES = 20

/** Session subset used by the model service. */
export interface ModelSession {
    request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T>
}

/** Pool subset used by the model service. */
export interface ModelSessionPool {
    get(userId: string): Promise<ModelSession>
}

interface CacheEntry {
    loadedAt: number
    models: ModelOption[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readText(record: Record<string, unknown>, key: string): string {
    const value = record[key]
    return typeof value === 'string' ? value : ''
}

function mapEfforts(value: unknown): EffortOption[] {
    if (!Array.isArray(value)) {
        return []
    }
    const efforts: EffortOption[] = []
    for (const option of value) {
        if (isRecord(option) && typeof option.reasoningEffort === 'string') {
            efforts.push({ id: option.reasoningEffort, description: readText(option, 'description') })
        }
    }
    return efforts
}

/**
 * Maps one raw `model/list` entry to a UI model option.
 *
 * @param raw model entry
 * @returns option, or null for hidden / malformed entries
 */
export function mapModel(raw: unknown): ModelOption | null {
    if (!isRecord(raw) || raw.hidden === true) {
        return null
    }
    const modelId = readText(raw, 'model') || readText(raw, 'id')
    if (modelId === '') {
        return null
    }
    const efforts = mapEfforts(raw.supportedReasoningEfforts)
    const defaultEffort = readText(raw, 'defaultReasoningEffort') || efforts[0]?.id || ''
    return {
        id: modelId,
        displayName: readText(raw, 'displayName') || modelId,
        description: readText(raw, 'description'),
        isDefault: raw.isDefault === true,
        efforts,
        defaultEffort,
    }
}

/**
 * Maps raw models, dropping hidden, malformed and duplicate entries.
 *
 * @param rawModels raw `model/list` data items
 * @returns model options in server order
 */
export function mapModels(rawModels: unknown[]): ModelOption[] {
    const seen = new Set<string>()
    const models: ModelOption[] = []
    for (const raw of rawModels) {
        const option = mapModel(raw)
        if (option !== null && !seen.has(option.id)) {
            seen.add(option.id)
            models.push(option)
        }
    }
    return models
}

/** Lists Codex models available to each HA user. */
export class ModelService {
    private readonly cache = new Map<string, CacheEntry>()

    /**
     * @param pool Codex session pool
     * @param now clock (replaceable in tests)
     */
    public constructor(private readonly pool: ModelSessionPool, private readonly now: () => number = Date.now) {}

    /**
     * Returns visible models (cached for 10 minutes per user).
     *
     * @param userId HA user id
     * @returns model options
     */
    public async listModels(userId: string): Promise<ModelOption[]> {
        const cached = this.cache.get(userId)
        if (cached !== undefined && this.now() - cached.loadedAt < MODEL_CACHE_TTL_MS) {
            return cached.models
        }
        const models = mapModels(await this.fetchAll(userId))
        this.cache.set(userId, { loadedAt: this.now(), models })
        return models
    }

    /**
     * Drops the cached list of a user (e.g. after logout).
     *
     * @param userId HA user id
     */
    public invalidate(userId: string): void {
        this.cache.delete(userId)
    }

    private async fetchAll(userId: string): Promise<unknown[]> {
        const session = await this.pool.get(userId)
        const items: unknown[] = []
        let cursor: string | null = null
        for (let page = 0; page < MAX_PAGES; page++) {
            const response: Partial<ModelListResponse> | null = await session.request<ModelListResponse>(
                CODEX_METHODS.modelList,
                { includeHidden: false, cursor },
                SHORT_REQUEST_TIMEOUT_MS,
            )
            if (Array.isArray(response?.data)) {
                items.push(...response.data)
            }
            cursor = typeof response?.nextCursor === 'string' && response.nextCursor !== '' ? response.nextCursor : null
            if (cursor === null) {
                break
            }
        }
        return items
    }
}
