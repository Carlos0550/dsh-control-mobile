// tests/attention.spec.ts
import { describe, expect, it } from 'vitest'
import { createAttention, type ApprovalOutcome } from '../src/attention.ts'
import type { Delta } from '../src/types.ts'

function harness() {
  const emitted: Delta[] = []
  let nextId = 0
  const attention = createAttention({
    emit: delta => { emitted.push(delta) },
    now: () => 1_000,
    id: () => `att-${++nextId}`,
    sessionIdOf: () => 'session-1',
  })
  return { attention, emitted }
}

describe('createAttention', () => {
  it('publica la petición, espera, y devuelve el outcome al decidir', async () => {
    const { attention, emitted } = harness()
    let resolveRequest: ((outcome: ApprovalOutcome) => void) | undefined
    const pending = new Promise<ApprovalOutcome>(resolve => { resolveRequest = resolve })
    // The plan's test passed three arguments (agent, request, next); the plan's
    // own AttentionService takes hold(request, next) and reads request.agent, so
    // the two calls below carry the agent inside the request, as the event does.
    const outcome = attention.hold({ agent: {}, toolName: 'bash', reason: 'rm -rf dist' }, () => pending)
    expect(attention.count()).toBe(1)
    expect(attention.list()[0]).toMatchObject({ kind: 'approval', sessionId: 'session-1', summary: 'rm -rf dist' })
    expect(emitted[0]).toMatchObject({ t: 'attention.open' })
    const id = attention.list()[0]!.id
    expect(attention.decide(id, 'allow')).toBe(true)
    resolveRequest!('allowed-once')
    await expect(outcome).resolves.toBe('allowed-once')
    expect(attention.count()).toBe(0)
    expect(emitted.at(-1)).toEqual({ t: 'attention.close', id })
  })

  it('decide en falso si el id ya no existe', () => {
    const { attention } = harness()
    expect(attention.decide('att-999', 'allow')).toBe(false)
  })

  it('un signal ya abortado no deja la petición colgada', async () => {
    const { attention } = harness()
    const controller = new AbortController()
    controller.abort()
    const outcome = await attention.hold(
      { agent: {}, toolName: 'bash', signal: controller.signal },
      () => new Promise<ApprovalOutcome>(() => {}),
    )
    expect(outcome).toBe('cancelled')
    expect(attention.count()).toBe(0)
  })
})
