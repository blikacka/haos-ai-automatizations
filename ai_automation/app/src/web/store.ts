/**
 * Tiny observable store with selector based subscriptions.
 */

export type Listener<T> = (state: T, previous: T) => void

export type Equality<S> = (left: S, right: S) => boolean

/**
 * Compares two values by reference, or shallowly when both are plain arrays/objects.
 */
export function shallowEqual<S>(left: S, right: S): boolean {
    if (Object.is(left, right)) {
        return true
    }
    if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
        return false
    }
    if (Array.isArray(left) !== Array.isArray(right)) {
        return false
    }
    const leftRecord = left as Record<string, unknown>
    const rightRecord = right as Record<string, unknown>
    const leftKeys = Object.keys(leftRecord)
    if (leftKeys.length !== Object.keys(rightRecord).length) {
        return false
    }
    return leftKeys.every((key) => Object.is(leftRecord[key], rightRecord[key]))
}

/** Observable application state container. */
export class Store<T extends object> {
    private state: T

    private readonly listeners = new Set<Listener<T>>()

    constructor(initial: T) {
        this.state = initial
    }

    /** Returns the current immutable state snapshot. */
    get(): T {
        return this.state
    }

    /** Merges a partial update and notifies listeners. */
    set(patch: Partial<T> | ((state: T) => Partial<T>)): void {
        const previous = this.state
        const partial = typeof patch === 'function' ? patch(previous) : patch
        this.state = { ...previous, ...partial }
        this.listeners.forEach((listener) => listener(this.state, previous))
    }

    /** Subscribes to every change; returns an unsubscribe function. */
    subscribe(listener: Listener<T>): () => void {
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }

    /**
     * Calls `listener` immediately and whenever the selected slice changes.
     */
    watch<S>(
        selector: (state: T) => S,
        listener: (value: S, state: T) => void,
        equals: Equality<S> = shallowEqual,
    ): () => void {
        let current = selector(this.state)
        listener(current, this.state)
        return this.subscribe((state) => {
            const next = selector(state)
            if (!equals(current, next)) {
                current = next
                listener(next, state)
            }
        })
    }
}
