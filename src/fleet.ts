import type { AgentCard, AgentState, AttentionSource, FleetSnapshot, SessionFacts } from './types.ts'

/** Inputs of one fleet snapshot. */
export interface BuildFleetInput {
  sessions: readonly SessionFacts[]
  attention: AttentionSource
  workspaces: readonly string[]
  access: FleetSnapshot['access']
  limit: number
  asOf: number
}

/** Rank of one agent: what waits for the operator leads. */
function rank(session: SessionFacts): number {
  if (session.waiting !== undefined) return 0
  if (session.errored === true) return 1
  if (session.running) return 2
  return 3
}

/** Depth of one session in its parent chain, 0 for a root. */
function depthOf(session: SessionFacts, byId: ReadonlyMap<string, SessionFacts>): number {
  let depth = 0
  let cursor = session.parentSessionId
  const seen = new Set<string>([session.sessionId])
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor)
    depth += 1
    cursor = byId.get(cursor)?.parentSessionId
  }
  return depth
}

/**
 * Order sessions so the board reads top-down: the group that needs the operator
 * first, then by recent activity, with every child immediately after its parent.
 * @param sessions - flattened session facts.
 * @returns a new array in board order.
 */
export function orderAgents(sessions: readonly SessionFacts[]): SessionFacts[] {
  const byId = new Map(sessions.map(s => [s.sessionId, s]))
  const rootOf = (session: SessionFacts): string => {
    let cursor = session
    const seen = new Set<string>([session.sessionId])
    while (cursor.parentSessionId !== undefined && !seen.has(cursor.parentSessionId)) {
      const parent = byId.get(cursor.parentSessionId)
      if (parent === undefined) break
      seen.add(parent.sessionId)
      cursor = parent
    }
    return cursor.sessionId
  }
  const groups = new Map<string, SessionFacts[]>()
  for (const session of sessions) {
    const key = rootOf(session)
    const bucket = groups.get(key)
    if (bucket === undefined) groups.set(key, [session])
    else bucket.push(session)
  }
  const ordered: SessionFacts[] = []
  const ranked = [...groups.values()].map(members => ({
    members,
    best: Math.min(...members.map(rank)),
    recent: Math.max(...members.map(m => m.updatedAt)),
  }))
  ranked.sort((a, b) => a.best - b.best || b.recent - a.recent || a.members[0]!.sessionId.localeCompare(b.members[0]!.sessionId))
  for (const group of ranked) {
    group.members.sort((a, b) =>
      depthOf(a, byId) - depthOf(b, byId) || b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId))
    ordered.push(...group.members)
  }
  return ordered
}

/** State of one session given the attention it currently owns. */
function stateOf(session: SessionFacts): AgentState {
  if (session.waiting === 'approval') return 'waiting-approval'
  if (session.waiting === 'question') return 'waiting-answer'
  if (session.errored === true) return 'error'
  if (session.running) return 'running'
  return 'idle'
}

/**
 * Build the complete board state.
 * @param input - facts, attention, workspaces, access and limits.
 * @returns the snapshot the page renders.
 */
export function buildFleet(input: BuildFleetInput): FleetSnapshot {
  const attention = input.attention.list()
  const waitingOf = new Map<string, 'approval' | 'question'>()
  for (const item of attention) {
    if (item.kind !== 'error' && !waitingOf.has(item.sessionId)) waitingOf.set(item.sessionId, item.kind)
  }
  const sessions = input.sessions.map(s =>
    s.waiting === undefined && waitingOf.has(s.sessionId) ? { ...s, waiting: waitingOf.get(s.sessionId)! } : s)
  const byId = new Map(sessions.map(s => [s.sessionId, s]))
  const ordered = orderAgents(sessions)
  const kept = ordered.slice(0, input.limit)
  const agents: AgentCard[] = kept.map(session => {
    const context = session.context === undefined
      ? undefined
      : {
          used: session.context.used,
          window: session.context.window,
          percent: session.context.window === 0
            ? 0
            : Math.min(100, Math.round(session.context.used / session.context.window * 100)),
        }
    return {
      sessionId: session.sessionId,
      ...session.parentSessionId === undefined ? {} : { parentSessionId: session.parentSessionId },
      depth: depthOf(session, byId),
      kind: session.kind,
      title: session.title,
      workspace: session.workspace,
      ...session.model === undefined ? {} : { model: session.model },
      state: stateOf(session),
      metrics: {
        ...session.tokensPerSecond === undefined ? {} : { tokensPerSecond: session.tokensPerSecond },
        ...context === undefined ? {} : { context },
        lastActivityAt: session.updatedAt,
      },
      ...session.lastLine === undefined ? {} : { lastLine: session.lastLine },
      promptable: session.kind === 'root' || session.agentAvailable,
    }
  })
  const visible = new Set(agents.map(a => a.sessionId))
  const attention2 = attention.filter(item => visible.has(item.sessionId))
  return {
    asOf: input.asOf,
    agents,
    attention: [...attention2],
    workspaces: [...input.workspaces],
    truncated: ordered.length > agents.length,
    access: input.access,
  }
}
