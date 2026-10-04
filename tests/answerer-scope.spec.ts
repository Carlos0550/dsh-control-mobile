// tests/answerer-scope.spec.ts
import { Context } from '@deepseek-ai/cordis'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import { describe, expect, it } from 'vitest'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** One approval request, dispatched against the asking agent's scope. */
    'approval/request'(
      this: unknown,
      request: { toolName: string },
      next: () => Promise<string>,
    ): Promise<string>
  }
}

describe('approval answerer scope', () => {
  it('un answerer registrado en la raíz recibe el waterfall con ámbito de agente', async () => {
    const ctx = new Context()
    const seen: string[] = []
    ctx.on('approval/request', (request) => {
      seen.push(request.toolName)
      return Promise.resolve('allowed-once')
    })
    const agent = { session: { id: 'session-1' } }
    const outcome = await ctx.waterfall(
      scopeTarget(agent, agent),
      'approval/request',
      { toolName: 'bash' },
      () => Promise.resolve('unavailable'),
    )
    expect(outcome).toBe('allowed-once')
    expect(seen).toEqual(['bash'])
  })

  it('sin answerer, el waterfall cae en el valor de fallo en cerrado', async () => {
    const ctx = new Context()
    const agent = { session: { id: 'session-1' } }
    const outcome = await ctx.waterfall(
      scopeTarget(agent, agent),
      'approval/request',
      { toolName: 'bash' },
      () => Promise.resolve('unavailable'),
    )
    expect(outcome).toBe('unavailable')
  })
})
