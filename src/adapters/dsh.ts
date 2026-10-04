import type { SessionFacts } from '../types.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DshHelpers {
  titleOf(sessionId: string): Promise<string | undefined>
  contextWindowOf(model: string | undefined): number
  hotWindowMs: number
}

export interface DshPort {
  facts(signal: AbortSignal): Promise<SessionFacts[]>
  workspaces(): readonly string[]
  sessionIdOf(agent: { session: { id: string } }): string
  watchSessionEvents(handler: (sessionId: string) => void): () => void
  startSession(cwd: string, prompt: string): Promise<string | undefined>
  sendPrompt(sessionId: string, text: string): Promise<void>
  interrupt(sessionId: string): Promise<void>
  modelOf(sessionId: string): Promise<string | undefined>
}

interface SessionSummary {
  sessionId: string
  agentAvailable: boolean
  updatedAt: number
  running: boolean
  blank: boolean
  parentSessionId?: string
  origin?: 'subagent'
  cwd?: string
  projections?: {
    kind: 'cached' | 'sequenced'
    asOfSeq: number
    values: Record<string, unknown>
  }
}

interface ListResult {
  items: SessionSummary[]
}

interface SessionController {
  list(options: Record<string, never>, signal: AbortSignal): Promise<ListResult>
  create(options: { cwd: string; agentPreset?: string }, signal?: AbortSignal): Promise<{ sessionId: string }>
  prompt(options: {
    requestId: string
    sessionId: string
    mode: 'queue' | 'steer'
    content: readonly { type: 'text'; text: string }[]
  }, signal?: AbortSignal): Promise<{ accepted: true }>
  cancel(options: { sessionId: string }, signal?: AbortSignal): Promise<{ cancelled: boolean }>
}

interface Subagents {
  listChildren(parentSessionId: string, signal?: AbortSignal): Promise<unknown[]>
}

interface TokenMeter {
  measure(session: { id: string }): { totalTokens: number }
}

interface Workspace {
  path: string
}

interface WorkspaceRegistry {
  list(): Workspace[]
}

interface Context {
  sessionController: SessionController
  subagents: Subagents
  tokenMeter: TokenMeter
  workspaceRegistry: WorkspaceRegistry
  on(event: 'session/event', handler: (session: { id: string }, event: unknown) => void): () => void
}

// ---------------------------------------------------------------------------
// createDshHelpers
// ---------------------------------------------------------------------------

export async function createDshHelpers(
  ctx: Context,
  options: { hotWindowMs: number },
): Promise<DshHelpers> {
  const cache = new Map<string, string | undefined>()
  const tokenMeterCache = new Map<string, number>()

  async function titleOf(sessionId: string): Promise<string | undefined> {
    if (cache.has(sessionId)) return cache.get(sessionId)
    try {
      const { items } = await ctx.sessionController.list({}, new AbortController().signal)
      const summary = items.find(s => s.sessionId === sessionId)
      const title = summary?.projections?.values?.title as string | null | undefined
      const result = title ?? undefined
      cache.set(sessionId, result)
      return result
    } catch {
      cache.set(sessionId, undefined)
      return undefined
    }
  }

  function contextWindowOf(model: string | undefined): number {
    if (!model) return 0
    if (tokenMeterCache.has(model)) return tokenMeterCache.get(model)!
    return 0 // context window requires live tokenMeter measurement per session
  }

  return {
    titleOf,
    contextWindowOf,
    hotWindowMs: options.hotWindowMs,
  }
}

// ---------------------------------------------------------------------------
// createDshPort
// ---------------------------------------------------------------------------

export function createDshPort(ctx: Context, helpers: DshHelpers): DshPort {
  async function facts(signal: AbortSignal): Promise<SessionFacts[]> {
    try {
      const { items } = await ctx.sessionController.list({}, signal)
      const now = Date.now()
      const results: SessionFacts[] = []

      // PLAN RULE 2: Build set of parent sessionIds to find roots with children
      const parentSessionIds = new Set(items.map(s => s.parentSessionId).filter((id): id is string => id !== undefined))

      for (const summary of items) {
        const isHot = summary.running || summary.updatedAt >= now - helpers.hotWindowMs

        // Title: projection title > helpers.titleOf > sessionId.slice(0,8)
        let title = (summary.projections?.values?.title as string | null) ?? undefined
        if (title === undefined || title === null) {
          try {
            title = await helpers.titleOf(summary.sessionId)
          } catch {
            title = undefined
          }
        }
        title = title ?? summary.sessionId.slice(0, 8)

        const model = getModelFromProjection(summary)
        const kind: 'root' | 'subagent' = summary.origin === 'subagent' ? 'subagent' : 'root'
        const workspace = summary.cwd ?? '(sin workspace)'

        const fact: SessionFacts = {
          sessionId: summary.sessionId,
          ...(summary.parentSessionId === undefined ? {} : { parentSessionId: summary.parentSessionId }),
          kind,
          title,
          workspace,
          running: summary.running,
          agentAvailable: summary.agentAvailable,
          updatedAt: summary.updatedAt,
          ...(model === undefined ? {} : { model }),
        }

        // Context is only added for hot sessions
        if (isHot) {
          try {
            const measurement = ctx.tokenMeter.measure({ id: summary.sessionId })
            const window = (summary.projections?.values?.contextPressure as { contextWindow?: number } | undefined)?.contextWindow
              ?? helpers.contextWindowOf(model)

            if (window && window > 0) {
              fact.context = {
                used: measurement.totalTokens,
                window,
              }
            }
          } catch {
            // context measurement failed, leave context undefined
          }
        }

        results.push(fact)
      }

      // PLAN RULE 2: Resolve children with listChildren for root sessions that are parents
      const existingIds = new Set(results.map(f => f.sessionId))
      for (const summary of items) {
        // Only call listChildren for root sessions that appear as a parent
        if (summary.origin === 'subagent' || !parentSessionIds.has(summary.sessionId)) continue

        try {
          const children = await ctx.subagents.listChildren(summary.sessionId, signal)
          for (const child of children) {
            // SubagentCatalogEntry shape: { id, createdAt } & ({ mode:'one-shot'; label? } | { mode:'continuable'; label } | { mode:'unknown'; label? })
            const entry = child as { id: string; createdAt: number; mode: string; label?: string }
            if (existingIds.has(entry.id)) continue // Don't emit duplicates

            const childFact: SessionFacts = {
              sessionId: entry.id,
              parentSessionId: summary.sessionId,
              kind: 'subagent',
              title: entry.label ?? entry.id.slice(0, 8),
              workspace: summary.cwd ?? '(sin workspace)',
              running: false,
              agentAvailable: entry.mode === 'continuable',
              updatedAt: entry.createdAt,
            }
            results.push(childFact)
            existingIds.add(entry.id)
          }
        } catch (err) {
          console.error('[dsh.adapter] listChildren failed for', summary.sessionId, err)
        }
      }

      return results
    } catch (err) {
      console.error('[dsh.adapter] facts failed:', err)
      return []
    }
  }

  function workspaces(): readonly string[] {
    try {
      return ctx.workspaceRegistry.list().map(w => w.path)
    } catch (err) {
      console.error('[dsh.adapter] workspaces failed:', err)
      return []
    }
  }

  function sessionIdOf(agent: { session: { id: string } }): string {
    return agent.session.id
  }

  function watchSessionEvents(handler: (sessionId: string) => void): () => void {
    const unsubscribe = ctx.on('session/event', (session) => {
      handler(session.id)
    })
    return unsubscribe
  }

  async function startSession(cwd: string, prompt: string): Promise<string | undefined> {
    try {
      const { sessionId } = await ctx.sessionController.create({ cwd })
      await sendPrompt(sessionId, prompt)
      return sessionId
    } catch (err) {
      console.error('[dsh.adapter] startSession failed:', err)
      return ''
    }
  }

  async function sendPrompt(sessionId: string, text: string): Promise<void> {
    try {
      await ctx.sessionController.prompt({
        requestId: crypto.randomUUID(),
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text }],
      })
    } catch (err) {
      console.error('[dsh.adapter] sendPrompt failed:', err)
    }
  }

  async function interrupt(sessionId: string): Promise<void> {
    try {
      await ctx.sessionController.cancel({ sessionId })
    } catch (err) {
      console.error('[dsh.adapter] interrupt failed:', err)
    }
  }

  async function modelOf(sessionId: string): Promise<string | undefined> {
    try {
      const { items } = await ctx.sessionController.list({}, new AbortController().signal)
      const summary = items.find(s => s.sessionId === sessionId)
      return getModelFromProjection(summary)
    } catch {
      return undefined
    }
  }

  return {
    facts,
    workspaces,
    sessionIdOf,
    watchSessionEvents,
    startSession,
    sendPrompt,
    interrupt,
    modelOf,
  }
}

function getModelFromProjection(summary: SessionSummary | undefined): string | undefined {
  if (!summary?.projections?.values) return undefined
  const values = summary.projections.values
  // modelSelection.next takes precedence over modelSelection.lastUsed
  const next = values.modelSelection as { next?: { model?: string } } | undefined
  const lastUsed = values.modelSelection as { lastUsed?: { model?: string } } | undefined
  return next?.next?.model ?? lastUsed?.lastUsed?.model ?? undefined
}
