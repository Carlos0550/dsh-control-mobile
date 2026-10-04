import type { FleetSnapshot } from '../../../src/types.ts'
import { AgentRow } from '../components/AgentRow.tsx'

interface BoardProps {
  fleet: FleetSnapshot
  connected?: boolean
  onOpen: (sessionId: string) => void
  onOpenAttention: () => void
  onNew?: () => void
}

export function Board({ fleet, connected = true, onOpen, onOpenAttention, onNew }: BoardProps) {
  const running = fleet.agents.filter(a => a.state === 'running').length
  const idle = fleet.agents.filter(a => a.state === 'idle').length
  const waiting = fleet.agents.filter(a => a.state === 'waiting-approval' || a.state === 'waiting-answer').length
  const error = fleet.agents.filter(a => a.state === 'error').length

  if (!connected) {
    return (
      <div className="board board--disconnected">
        <div className="board-offline-banner">Sin conexión, reintentando</div>
        <BoardInner fleet={fleet} running={running} idle={idle} waiting={waiting} error={error} onOpen={onOpen} onOpenAttention={onOpenAttention} onNew={onNew} />
      </div>
    )
  }

  return (
    <BoardInner fleet={fleet} running={running} idle={idle} waiting={waiting} error={error} onOpen={onOpen} onOpenAttention={onOpenAttention} onNew={onNew} />
  )
}

interface BoardInnerProps {
  fleet: FleetSnapshot
  running: number
  idle: number
  waiting: number
  error: number
  onOpen: (sessionId: string) => void
  onOpenAttention: () => void
  onNew: (() => void) | undefined
}

function BoardInner({ fleet, running, idle, waiting, error, onOpen, onOpenAttention, onNew }: BoardInnerProps) {
  if (fleet.agents.length === 0) {
    return (
      <div className="board board--empty">
        <p className="board-empty-msg">Nada corriendo</p>
        <button className="btn-new-agent" onClick={onNew}>Nuevo</button>
      </div>
    )
  }

  const hasAttention = fleet.attention.length > 0

  return (
    <div className="board">
      <div className="board-counters">
        {running > 0 && <span className="counter counter--running">{running}</span>}
        {idle > 0 && <span className="counter counter--idle">{idle} idle</span>}
        {waiting > 0 && <span className="counter counter--waiting">{waiting} waiting</span>}
        {error > 0 && <span className="counter counter--error">{error} error</span>}
      </div>

      {hasAttention && (
        <button className="attention-banner" onClick={onOpenAttention}>
          {fleet.attention.length} aprobación{fleet.attention.length > 1 ? 'es' : ''} esperando
        </button>
      )}

      <div className="agent-list">
        {fleet.agents.map(agent => (
          <AgentRow key={agent.sessionId} agent={agent} onOpen={onOpen} />
        ))}
      </div>

      {fleet.truncated && (
        <p className="board-truncated">mostrando los primeros {fleet.agents.length} agentes</p>
      )}
    </div>
  )
}
