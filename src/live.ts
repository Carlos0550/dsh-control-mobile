import type { Delta } from './types.ts'

/** Fan-out of deltas to every connected page. */
export interface DeltaHub {
  subscribe(listener: (delta: Delta) => void): () => void
  publish(delta: Delta): void
  subscribers(): number
}

/**
 * Create a hub where one broken subscriber never silences the others.
 * @returns the hub.
 */
export function createHub(): DeltaHub {
  const listeners = new Set<(delta: Delta) => void>()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    publish(delta) {
      for (const listener of [...listeners]) {
        try {
          listener(delta)
        } catch {
          // A closed socket is not a reason to stop serving the others.
        }
      }
    },
    subscribers: () => listeners.size,
  }
}

/** Timer seam, so tests drive the quiet period without fake timers. */
export interface Timer {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const systemTimer: Timer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => { clearTimeout(handle as ReturnType<typeof setTimeout>) },
}

/** Coalesces a burst of session changes into as few flushes as possible. */
export interface Coalescer {
  changed(sessionId: string): void
  pending(): number
  dispose(): void
}

/**
 * Create a coalescer that waits for quiet before flushing dirty session ids.
 * @param options - quiet period, flush callback, and the timer seam.
 * @returns the coalescer.
 */
export function createCoalescer(options: {
  quietMs: number
  flush: (ids: ReadonlySet<string>) => Promise<void> | void
  timer?: Timer
}): Coalescer {
  const timer = options.timer ?? systemTimer
  const dirty = new Set<string>()
  let handle: unknown
  let running = false
  const run = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      while (dirty.size > 0) {
        const batch = new Set(dirty)
        dirty.clear()
        await options.flush(batch)
      }
    } finally {
      running = false
    }
  }
  return {
    changed(sessionId) {
      dirty.add(sessionId)
      if (handle !== undefined) timer.clear(handle)
      handle = timer.set(() => {
        handle = undefined
        void run()
      }, options.quietMs)
    },
    pending: () => dirty.size,
    dispose() {
      if (handle !== undefined) {
        timer.clear(handle)
        handle = undefined
      }
    },
  }
}
