import type { VersionSummary } from '../../shared/api'
import {
    api,
    errorMessage,
} from '../api'
import { shortId } from '../format'
import {
    setHistory,
    store,
} from '../state'
import { confirmDialog } from '../views/modal'
import {
    showError,
    showToast,
} from '../views/toast'

const PAGE_SIZE = 30

/** Loads the first page of the version history. */
export async function loadHistory(): Promise<void> {
    setHistory({ loading: true, error: null })
    try {
        const page = await api.history(PAGE_SIZE, null)
        const detail = store.get().history.detail
        const fresh = detail ? page.versions.find((version) => version.id === detail.id) : undefined
        setHistory({
            versions: page.versions,
            nextCursor: page.nextCursor,
            loaded: true,
            loading: false,
            detail: detail && fresh ? { ...detail, isCurrent: fresh.isCurrent } : detail,
        })
    } catch (error) {
        setHistory({ loading: false, loaded: true, error: errorMessage(error) })
    }
}

/** Appends the next page of versions. */
export async function loadMoreHistory(): Promise<void> {
    const { nextCursor, loading, versions } = store.get().history
    if (!nextCursor || loading) {
        return
    }
    setHistory({ loading: true })
    try {
        const page = await api.history(PAGE_SIZE, nextCursor)
        const known = new Set(versions.map((version) => version.id))
        setHistory({
            versions: [...versions, ...page.versions.filter((version) => !known.has(version.id))],
            nextCursor: page.nextCursor,
            loading: false,
        })
    } catch (error) {
        setHistory({ loading: false })
        showError('Další verze se nepodařilo načíst', errorMessage(error))
    }
}

/** Selects a version and loads its diff; null closes the detail. */
export async function selectVersion(versionId: string | null): Promise<void> {
    setHistory({ selectedId: versionId, detail: null, detailLoading: versionId !== null })
    if (!versionId) {
        return
    }
    try {
        const detail = await api.version(versionId)
        if (store.get().history.selectedId === versionId) {
            setHistory({ detail, detailLoading: false })
        }
    } catch (error) {
        if (store.get().history.selectedId === versionId) {
            setHistory({ detailLoading: false, selectedId: null })
        }
        showError('Verzi se nepodařilo načíst', errorMessage(error))
    }
}

/** Switches the main area to the history view. */
export function showHistory(): void {
    store.set({ view: 'history', drawerOpen: false })
    if (!store.get().history.loaded) {
        void loadHistory()
    }
}

/** Opens the history view with a specific version selected (links from chat cards). */
export function openVersion(versionId: string): void {
    showHistory()
    void selectVersion(versionId)
}

/** Asks for confirmation and restarts Home Assistant Core. */
export async function restartHomeAssistant(): Promise<void> {
    const confirmed = await confirmDialog({
        title: 'Restartovat Home Assistant?',
        body: ['Home Assistant bude během restartu na chvíli nedostupný (obvykle 1–2 minuty). Před restartem se konfigurace znovu ověří.'],
        confirmLabel: 'Restartovat',
    })
    if (!confirmed) {
        return
    }
    try {
        await api.restart()
        showToast({ kind: 'info', title: 'Home Assistant se restartuje', message: 'Za chvíli bude opět k dispozici.' })
    } catch (error) {
        showError('Restart se nepodařil', errorMessage(error))
    }
}

/**
 * Confirms and restores a version, then reports the outcome in a toast.
 */
export async function restoreVersion(version: VersionSummary): Promise<void> {
    const confirmed = await confirmDialog({
        title: `Obnovit verzi ${version.shortId || shortId(version.id)}?`,
        body: [
            `Konfigurace se vrátí do stavu „${version.title}“.`,
            'Současný stav se nejdřív uloží jako nová verze, takže obnovení můžete kdykoli vrátit zpět.',
            'Po obnovení se konfigurace automaticky ověří – kdyby nebyla v pořádku, vše se vrátí do původního stavu.',
        ],
        confirmLabel: 'Obnovit tuto verzi',
    })
    if (!confirmed) {
        return
    }
    setHistory({ restoring: true })
    try {
        const result = await api.restore(version.id)
        if (!result.checkPassed) {
            showToast({ kind: 'warning', title: 'Verze nebyla obnovena', message: result.message || 'Obnovená konfigurace neprošla kontrolou, proto zůstal původní stav.' })
        } else if (result.needsRestart) {
            showToast({
                kind: 'success',
                title: 'Verze obnovena',
                message: result.message || 'Některé změny se projeví až po restartu Home Assistantu.',
                action: { label: 'Restartovat Home Assistant', run: () => void restartHomeAssistant() },
            })
        } else {
            showToast({ kind: 'success', title: 'Verze obnovena', message: result.message || 'Konfigurace byla ověřena a znovu načtena.' })
        }
        await loadHistory()
        if (result.version) {
            await selectVersion(result.version.id)
        }
    } catch (error) {
        showError('Obnovení se nepodařilo', errorMessage(error))
    } finally {
        setHistory({ restoring: false })
    }
}
