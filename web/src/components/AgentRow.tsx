import type { AgentCard } from '../../../src/types.ts'
import { MetricStrip } from './MetricStrip.tsx'

interface AgentRowProps {
  agent: AgentCard
  onOpen: (sessionId: string) => void
}

export function AgentRow({ agent, onOpen }: AgentRowProps) {
  const dotClass = agent.state === 'waiting-approval' || agent.state === 'waiting-answer'
    ? 'waiting'
    : agent.state

  return (
    <div
      className={`agent-row agent-row--${agent.state}`}
      data-depth={agent.depth}
      style={{ paddingLeft: `calc(${agent.depth} * 14px)` }}
    >
      <span className={`status-dot status-dot--${dotClass}`} />
      <div className="agent-row-body">
        <div className="agent-row-title">{agent.title}</div>
        <MetricStrip agent={agent} />
        {agent.state === 'error' && agent.lastLine && (
          <div className="agent-error">
            <span className="agent-error-reason">{agent.lastLine}</span>
            <button
              className="btn-retry"
              onClick={() => onOpen(agent.sessionId)}
            >
              Reintentar el turno
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
