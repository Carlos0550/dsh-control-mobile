import { describe, expect, it, vi } from 'vitest'
import { createDshPort, createDshHelpers } from '../src/adapters/dsh.ts'

const summary = (over: Record<string, unknown> = {}) => ({
  sessionId: 's1',
  agentAvailable: true,
  updatedAt: 10,
  running: true,
  blank: false,
  projections: {
    kind: 'sequenced' as const,
    asOfSeq: 1,
    values: {
      title: null,
      modelSelection: { lastUsed: { provider: 'deepseek', model: 'deepseek-chat' }, next: null },
      contextPressure: { pressureTokens: 100, projectedTokens: 200, contextWindow: 64000 },
    },
  },
  ...over,
})

function fakeContext(over: Record<string, unknown> = {}) {
  const handlers: ((session: unknown, event: unknown) => void)[] = []
  return {
    handlers,
    ctx: {
      sessionController: {
        list: async () => ({ items: [summary({}), summary({ sessionId: 'child', parentSessionId: 's1', origin: 'subagent', running: false, updatedAt: 5 })] }),
        create: async () => ({ sessionId: 'new-1' }),
        prompt: async () => ({ accepted: true }),
        cancel: () => ({ cancelled: true }),
      },
      subagents: { listChildren: async () => [] },
      tokenMeter: { measure: () => ({ totalTokens: 68 }) },
      workspaceRegistry: { list: () => [] },
      on: (event: string, handler: (session: unknown, e: unknown) => void) => {
        if (event === 'session/event') handlers.push(handler)
        return () => {}
      },
      ...over,
    },
  }
}

describe('createDshPort', () => {
  it('aplana los resúmenes en hechos de sesión, marcando los subagentes', async () => {
    const { ctx } = fakeContext()
    const port = createDshPort(ctx as never, { titleOf: async () => undefined, contextWindowOf: () => 1_000, hotWindowMs: 300_000 })
    const facts = await port.facts(new AbortController().signal)
    expect(facts.map(f => [f.sessionId, f.kind, f.running])).toEqual([['s1', 'root', true], ['child', 'subagent', false]])
    expect(facts[0]?.title).toBe('s1')
  })

  it('avisa de cada evento de sesión con su id', () => {
    const { ctx, handlers } = fakeContext()
    const port = createDshPort(ctx as never, { titleOf: async () => undefined, contextWindowOf: () => 1_000, hotWindowMs: 300_000 })
    const seen: string[] = []
    port.watchSessionEvents(id => seen.push(id))
    handlers[0]!({ id: 's1' }, { type: 'assistant/message' })
    expect(seen).toEqual(['s1'])
  })

  it('crea una sesión y le manda el primer prompt', async () => {
    const { ctx } = fakeContext()
    const port = createDshPort(ctx as never, { titleOf: async () => undefined, contextWindowOf: () => 1_000, hotWindowMs: 300_000 })
    expect(await port.startSession('/w', 'hola')).toBe('new-1')
  })

  // R21: startSession returns undefined on harness failure
  it('startSession devuelve undefined cuando create falla', async () => {
    const { ctx } = fakeContext({
      sessionController: {
        create: async () => { throw new Error('create failed') },
      },
    })
    const port = createDshPort(ctx as never, { titleOf: async () => undefined, contextWindowOf: () => 1_000, hotWindowMs: 300_000 })
    await expect(port.startSession('/w', 'hola')).resolves.toBeUndefined()
  })

  // R5: cold session must arrive without context
  it('una sesión fría llega sin context', async () => {
    const coldUpdatedAt = Date.now() - 400_000 // older than hotWindowMs (300_000)
    const { ctx } = fakeContext({
      sessionController: {
        list: async () => ({
          items: [summary({ sessionId: 'cold', running: false, updatedAt: coldUpdatedAt })]
        }),
        create: async () => ({ sessionId: 'new-1' }),
        prompt: async () => ({ accepted: true }),
        cancel: () => ({ cancelled: true }),
      },
    })
    const port = createDshPort(ctx as never, { titleOf: async () => undefined, contextWindowOf: () => 1_000, hotWindowMs: 300_000 })
    const facts = await port.facts(new AbortController().signal)
    expect(facts[0]?.context).toBeUndefined()
  })

  // Rule 2: listChildren output reaches facts()
  it('resuelve hijos via listChildren y los incluye en facts', async () => {
    const { ctx } = fakeContext({
      subagents: {
        listChildren: async (parentId: string) => {
          if (parentId === 's1') {
            return [{ id: 'grandchild', createdAt: 7, mode: 'continuable', label: 'Nieto' }]
          }
          return []
        },
      },
    })
    const port = createDshPort(ctx as never, { titleOf: async () => undefined, contextWindowOf: () => 1_000, hotWindowMs: 300_000 })
    const facts = await port.facts(new AbortController().signal)
    const grandchild = facts.find(f => f.sessionId === 'grandchild')
    expect(grandchild).toMatchObject({
      sessionId: 'grandchild',
      parentSessionId: 's1',
      kind: 'subagent',
      title: 'Nieto',
      agentAvailable: true, // continuable mode
    })
  })
})

describe('createDshHelpers', () => {
  it('devuelve titleOf y contextWindowOf y hotWindowMs', async () => {
    const mockCtx = {
      sessionController: {
        list: async () => ({
          items: [{
            sessionId: 's1',
            agentAvailable: true,
            updatedAt: Date.now(),
            running: true,
            blank: false,
            projections: {
              kind: 'sequenced' as const,
              asOfSeq: 1,
              values: { title: 'Test Title' },
            },
          }],
        }),
      },
    }
    const helpers = await createDshHelpers(mockCtx as never, { hotWindowMs: 300_000 })
    await expect(helpers.titleOf('s1')).resolves.toBe('Test Title')
    expect(helpers.contextWindowOf('deepseek-chat')).toBe(0) // no token meter data in mock
    expect(helpers.hotWindowMs).toBe(300_000)
  })

  it('titleOf falla gracefully sin título', async () => {
    const mockCtx = {
      sessionController: {
        list: async () => ({
          items: [{
            sessionId: 's1',
            agentAvailable: true,
            updatedAt: Date.now(),
            running: true,
            blank: false,
            projections: { kind: 'sequenced', asOfSeq: 1, values: {} },
          }],
        }),
      },
    }
    const helpers = await createDshHelpers(mockCtx as never, { hotWindowMs: 300_000 })
    await expect(helpers.titleOf('s1')).resolves.toBeUndefined()
  })

  it('contextWindowOf falla gracefully', async () => {
    const mockCtx = {
      sessionController: { list: async () => ({ items: [] }) },
    }
    const helpers = await createDshHelpers(mockCtx as never, { hotWindowMs: 300_000 })
    expect(helpers.contextWindowOf(undefined)).toBe(0)
    expect(helpers.contextWindowOf('unknown-model')).toBe(0)
  })
})
