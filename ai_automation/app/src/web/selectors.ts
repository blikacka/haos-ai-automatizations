import type { ModelOption } from '../shared/api'
import type { AppState } from './state'

/** Resolves the model used for new messages (settings, then default, then first). */
export function selectedModel(state: AppState): ModelOption | null {
    const { models, settings } = state
    return models.find((model) => model.id === settings.model)
        ?? models.find((model) => model.isDefault)
        ?? models[0]
        ?? null
}

/** Resolves the reasoning effort valid for the given model. */
export function selectedEffort(state: AppState, model: ModelOption | null): string | null {
    if (!model) {
        return state.settings.effort
    }
    const effort = state.settings.effort
    return model.efforts.some((option) => option.id === effort) ? effort : model.defaultEffort
}
