import type { Context } from '@deepseek-ai/cordis'
import type { AttentionItem, AttentionSource, Delta } from './types.ts'

/** Outcomes the harness accepts for one approval request. */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** Minimal shape of the approval request this module consumes. */
interface ApprovalRequestLike {
  agent: unknown
  toolName: string
  reason?: string
  signal?: AbortSignal
}

/** Pending-request registry, readable by the board and answerable by the page. */
export interface AttentionService extends AttentionSource {
  mount(ctx: Context): () => void
  hold(request: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>
  decide(id: string, decision: 'allow' | 'deny'): boolean
  count(): number
}

/**
 * Externally-resolvable promise, the pair hold() needs to publish a request and
 * settle it later. `Promise.withResolvers` would say this inline, but it is an
 * ES2024 API and this package compiles against the ES2023 library (target
 * ES2023 in tsconfig.json, no `lib` entry).
 * @returns the promise plus its resolve function.
 */
function withResolvers<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

/**
 * Create the attention registry.
 * @param deps - delta sink, clock, id source, and the agent-to-session accessor.
 * @returns the service.
 */
export function createAttention(deps: {
  emit: (delta: Delta) => void
  now: () => number
  id: () => string
  sessionIdOf: (agent: unknown) => string
}): AttentionService {
  const pending = new Map<string, { item: AttentionItem; settle: (outcome: ApprovalOutcome) => void }>()
  const close = (id: string): void => {
    pending.delete(id)
    deps.emit({ t: 'attention.close', id })
  }
  return {
    list: () => [...pending.values()].map(entry => entry.item),
    count: () => pending.size,
    decide(id, decision) {
      const entry = pending.get(id)
      if (entry === undefined) return false
      close(id)
      entry.settle(decision === 'allow' ? 'allowed-once' : 'rejected')
      return true
    },
    async hold(request, next) {
      if (request.signal?.aborted === true) return 'cancelled'
      const id = deps.id()
      const item: AttentionItem = {
        id,
        kind: 'approval',
        sessionId: deps.sessionIdOf(request.agent),
        since: deps.now(),
        summary: request.reason ?? request.toolName,
        detail: {
          toolName: request.toolName,
          ...request.reason === undefined ? {} : { reason: request.reason },
        },
      }
      const settled = withResolvers<ApprovalOutcome>()
      pending.set(id, { item, settle: settled.resolve })
      deps.emit({ t: 'attention.open', item })
      if (request.signal === undefined) return await settled.promise
      return await new Promise<ApprovalOutcome>(resolve => {
        const onAbort = (): void => {
          if (pending.has(id)) close(id)
          resolve('cancelled')
        }
        request.signal!.addEventListener('abort', onAbort, { once: true })
        void settled.promise.then(outcome => {
          request.signal!.removeEventListener('abort', onAbort)
          resolve(outcome)
        })
      })
    },
    mount(ctx) {
      const listener = (request: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> =>
        this.hold(request, next)
      return ctx.on('approval/request' as never, listener as never)
    },
  }
}
