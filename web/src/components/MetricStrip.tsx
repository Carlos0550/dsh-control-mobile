import type { AgentCard } from '../../../src/types.ts'

interface MetricStripProps {
  agent: AgentCard
}

export function MetricStrip({ agent }: MetricStripProps) {
  const pct = agent.metrics.context?.percent
  const barColor = pct === undefined
    ? 'transparent'
    : pct < 70
    ? 'var(--ok)'
    : pct < 90
    ? 'var(--warn)'
    : 'var(--bad)'

  return (
    <div className="metric-strip">
      {agent.metrics.tokensPerSecond !== undefined && (
        <span className="metric-tokps">{agent.metrics.tokensPerSecond} tok/s</span>
      )}
      {agent.model && <span className="metric-model">{agent.model}</span>}
      {pct !== undefined && (
        <div className="context-bar-wrap">
          <div
            className="context-bar"
            style={{ width: pct + '%', background: barColor }}
          />
        </div>
      )}
    </div>
  )
}
