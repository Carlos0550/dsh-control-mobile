import { describe, expect, it } from 'vitest'
import { buildFleet, orderAgents } from '../src/fleet.ts'
import type { SessionFacts } from '../src/types.ts'

const facts = (over: Partial<SessionFacts> & { sessionId: string }): SessionFacts => ({
  kind: 'root', title: over.sessionId, workspace: '/w', running: false,
  agentAvailable: true, updatedAt: 0, ...over,
})

describe('orderAgents', () => {
  it('pone primero lo que espera, luego lo que corre, y cada hijo bajo su padre', () => {
    const ordered = orderAgents([
      facts({ sessionId: 'parado', updatedAt: 900 }),
      facts({ sessionId: 'corriendo', running: true, updatedAt: 100 }),
      facts({ sessionId: 'hijo', kind: 'subagent', parentSessionId: 'parado', updatedAt: 50 }),
      facts({ sessionId: 'espera', waiting: 'approval', updatedAt: 10 }),
      facts({ sessionId: 'otro', updatedAt: 800 }),
    ])
    expect(ordered.map(s => s.sessionId)).toEqual(['espera', 'corriendo', 'parado', 'hijo', 'otro'])
  })
})

describe('buildFleet', () => {
  it('estima la profundidad por la cadena de padres y arma la tarjeta', () => {
    const fleet = buildFleet({
      sessions: [
        facts({ sessionId: 'papa', running: true, model: 'deepseek-flash', context: { used: 68, window: 100 }, tokensPerSecond: 42 }),
        facts({ sessionId: 'nieto', kind: 'subagent', parentSessionId: 'hijo', updatedAt: 5 }),
        facts({ sessionId: 'hijo', kind: 'subagent', parentSessionId: 'papa', updatedAt: 6 }),
      ],
      attention: { list: () => [] },
      workspaces: ['/w'],
      access: { mode: 'tailnet', declared: true },
      limit: 200,
      asOf: 1_000,
    })
    expect(fleet.agents.map(a => [a.sessionId, a.depth])).toEqual([['papa', 0], ['hijo', 1], ['nieto', 2]])
    expect(fleet.agents[0]?.state).toBe('running')
    expect(fleet.agents[0]?.metrics.context?.percent).toBe(68)
    expect(fleet.asOf).toBe(1_000)
  })

  it('marca waiting-approval cuando hay una petición de ese agente', () => {
    const fleet = buildFleet({
      sessions: [facts({ sessionId: 's1' })],
      attention: { list: () => [{ id: 'a1', kind: 'approval', sessionId: 's1', since: 1, summary: 'bash rm' }] },
      workspaces: [], access: { mode: 'loopback', declared: true }, limit: 200, asOf: 2,
    })
    expect(fleet.agents[0]?.state).toBe('waiting-approval')
    expect(fleet.attention).toHaveLength(1)
  })

  it('respeta el límite y avisa de que recortó', () => {
    const fleet = buildFleet({
      sessions: Array.from({ length: 5 }, (_, i) => facts({ sessionId: `s${i}`, updatedAt: i })),
      attention: { list: () => [] }, workspaces: [], access: { mode: 'loopback', declared: true },
      limit: 2, asOf: 3,
    })
    expect(fleet.agents).toHaveLength(2)
    expect(fleet.truncated).toBe(true)
  })
})
