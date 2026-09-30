/** Simple FIFO async mutex. */
export class Mutex {
    private locked = false
    private readonly waiters: (() => void)[] = []

    /**
     * Runs the callback when no other callback holds the lock.
     *
     * @param fn exclusive work
     * @returns result of fn
     */
    public async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire()
        try {
            return await fn()
        } finally {
            this.release()
        }
    }

    /** Whether the lock is currently held. */
    public get isLocked(): boolean {
        return this.locked
    }

    /** Number of callers waiting for the lock. */
    public get queueLength(): number {
        return this.waiters.length
    }

    private acquire(): Promise<void> {
        if (!this.locked) {
            this.locked = true
            return Promise.resolve()
        }
        return new Promise<void>((resolveWaiter) => {
            this.waiters.push(resolveWaiter)
        })
    }

    private release(): void {
        const next = this.waiters.shift()
        if (next === undefined) {
            this.locked = false
            return
        }
        next()
    }
}
