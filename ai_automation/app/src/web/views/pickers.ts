import type { ModelOption } from '../../shared/api'
import { saveSettings } from '../actions/session'
import { h } from '../dom'
import { effortLabel } from '../format'
import {
    selectedEffort,
    selectedModel,
} from '../selectors'
import { store } from '../state'

function option(value: string, label: string, title: string, selected: boolean): HTMLOptionElement {
    const element = h('option', { attrs: { value, title } }, label)
    element.selected = selected
    return element
}

function picker(label: string, select: HTMLSelectElement): HTMLElement {
    return h('label', 'picker', h('span', 'picker-label', label), select)
}

function fillModels(select: HTMLSelectElement, models: ModelOption[], current: ModelOption | null): void {
    select.replaceChildren(...models.map((model) =>
        option(model.id, model.displayName || model.id, model.description, model.id === current?.id)))
    select.disabled = models.length === 0
    select.title = current?.description ?? ''
    if (!models.length) {
        select.appendChild(option('', 'Načítám…', '', true))
    }
}

function fillEfforts(select: HTMLSelectElement, model: ModelOption | null, current: string | null): void {
    const efforts = model?.efforts ?? []
    select.replaceChildren(...efforts.map((effort) =>
        option(effort.id, effortLabel(effort.id), effort.description, effort.id === current)))
    select.disabled = efforts.length === 0
    select.title = efforts.find((effort) => effort.id === current)?.description ?? ''
    if (!efforts.length) {
        select.appendChild(option('', '—', '', true))
    }
}

/**
 * Model and reasoning ("Uvažování") pickers bound to user settings.
 */
export function createPickers(): HTMLElement {
    const modelSelect = h('select', { className: 'select', attrs: { 'aria-label': 'Model' } })
    const effortSelect = h('select', { className: 'select', attrs: { 'aria-label': 'Uvažování' } })

    modelSelect.addEventListener('change', () => {
        const model = store.get().models.find((item) => item.id === modelSelect.value) ?? null
        const effort = selectedEffort(store.get(), model)
        void saveSettings({ model: model?.id ?? null, effort })
    })
    effortSelect.addEventListener('change', () => {
        const model = selectedModel(store.get())
        void saveSettings({ model: model?.id ?? null, effort: effortSelect.value || null })
    })

    store.watch((state) => [state.models, state.settings], () => {
        const state = store.get()
        const model = selectedModel(state)
        fillModels(modelSelect, state.models, model)
        fillEfforts(effortSelect, model, selectedEffort(state, model))
    })

    return h('div', 'pickers', picker('Model', modelSelect), picker('Uvažování', effortSelect))
}
