import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Board } from './Board.tsx'
import type { FleetSnapshot } from '../../../src/types.ts'

const fleet: FleetSnapshot = {
  asOf: 1,
  agents: [
    { sessionId: 's1', depth: 0, kind: 'root', title: 'Refactor pagos', workspace: '/w', state: 'running', model: 'deepseek-flash', metrics: { tokensPerSecond: 42, context: { used: 68, window: 100, percent: 68 }, lastActivityAt: 1 }, promptable: true },
    { sessionId: 's2', parentSessionId: 's1', depth: 1, kind: 'subagent', title: 'Migración BD', workspace: '/w', state: 'idle', metrics: { lastActivityAt: 1 }, promptable: false },
  ],
  attention: [{ id: 'a1', kind: 'approval', sessionId: 's1', since: 1, summary: 'npm test' }],
  workspaces: ['/w'],
  truncated: false,
  access: { mode: 'loopback', declared: true },
}

describe('Board', () => {
  it('muestra los contadores, el banner de atención y una fila por agente', () => {
    render(<Board fleet={fleet} onOpen={() => {}} onOpenAttention={() => {}} />)
    expect(screen.getByText('1')).toBeDefined()
    expect(screen.getByText(/aprobación esperando/i)).toBeDefined()
    expect(screen.getByText('Refactor pagos')).toBeDefined()
    expect(screen.getByText('Migración BD')).toBeDefined()
    expect(screen.getByText('42 tok/s')).toBeDefined()
  })

  it('indenta los subagentes por profundidad', () => {
    render(<Board fleet={fleet} onOpen={() => {}} onOpenAttention={() => {}} />)
    const row = screen.getByText('Migración BD').closest('[data-depth]')
    expect(row?.getAttribute('data-depth')).toBe('1')
  })
})
