/** Lifecycle state of one agent as the cockpit shows it. */
export type AgentState = 'idle' | 'running' | 'waiting-approval' | 'waiting-answer' | 'error'

/** One renderable line of a conversation. */
export interface TranscriptEntry {
  seq: number
  kind: 'user' | 'assistant' | 'tool' | 'system' | 'error'
  text?: string
  tool?: { name: string; status: 'ok' | 'error' | 'running'; summary: string }
  at: number
  streaming?: boolean
}

/** One thing waiting for the operator. */
export interface AttentionItem {
  id: string
  kind: 'approval' | 'question' | 'error'
  sessionId: string
  since: number
  summary: string
  detail?: {
    toolName?: string
    reason?: string
    questions?: { id: string; header?: string; question: string; options?: { label: string }[] }[]
  }
}

/** One agent row of the board. */
export interface AgentCard {
  sessionId: string
  parentSessionId?: string
  depth: number
  kind: 'root' | 'subagent'
  title: string
  workspace: string
  model?: string
  state: AgentState
  metrics: {
    tokensPerSecond?: number
    context?: { used: number; window: number; percent: number }
    lastActivityAt: number
    turnStartedAt?: number
  }
  lastLine?: string
  promptable: boolean
}

/** Complete board state. */
export interface FleetSnapshot {
  asOf: number
  agents: AgentCard[]
  attention: AttentionItem[]
  workspaces: string[]
  truncated: boolean
  access: { mode: 'tailnet' | 'public' | 'loopback'; hostname?: string; declared: boolean }
}

/** One incremental board or transcript change. */
export type Delta =
  | { t: 'agent.upsert'; agent: AgentCard }
  | { t: 'agent.remove'; sessionId: string }
  | { t: 'attention.open'; item: AttentionItem }
  | { t: 'attention.close'; id: string }
  | { t: 'transcript.append'; sessionId: string; entry: TranscriptEntry }
  | { t: 'access'; access: FleetSnapshot['access'] }
  | { t: 'heartbeat'; at: number }

/** What the harness tells us about one session, already flattened. */
export interface SessionFacts {
  sessionId: string
  parentSessionId?: string
  kind: 'root' | 'subagent'
  title: string
  workspace: string
  running: boolean
  agentAvailable: boolean
  updatedAt: number
  model?: string
  context?: { used: number; window: number }
  tokensPerSecond?: number
  lastLine?: string
  waiting?: 'approval' | 'question'
  errored?: boolean
}

/** Read side of the pending-attention registry. */
export interface AttentionSource {
  list(): readonly AttentionItem[]
}
