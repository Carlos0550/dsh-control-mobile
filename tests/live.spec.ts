import { describe, expect, it } from 'vitest'
import { createCoalescer, createHub, type Timer } from '../src/live.ts'

describe('createHub', () => {
  it('reparte a todos los suscriptores y olvida al que se va', () => {
    const hub = createHub()
    const a: string[] = []
    const b: string[] = []
    const offA = hub.subscribe(d => a.push(d.t))
    hub.subscribe(d => b.push(d.t))
    hub.publish({ t: 'heartbeat', at: 1 })
    offA()
    hub.publish({ t: 'heartbeat', at: 2 })
    expect(a).toEqual(['heartbeat'])
    expect(b).toEqual(['heartbeat', 'heartbeat'])
    expect(hub.subscribers()).toBe(1)
  })

  it('una página rota no silencia a las demás', () => {
    const hub = createHub()
    const seen: string[] = []
    hub.subscribe(() => { throw new Error('socket cerrado') })
    hub.subscribe(d => seen.push(d.t))
    expect(() => hub.publish({ t: 'heartbeat', at: 1 })).not.toThrow()
    expect(seen).toEqual(['heartbeat'])
  })
})

describe('createCoalescer', () => {
  it('agrupa una ráfaga en un solo flush con la unión de sesiones', async () => {
    const scheduled: (() => void)[] = []
    const timer: Timer = { set: fn => { scheduled.push(fn); return scheduled.length }, clear: () => {} }
    const batches: string[][] = []
    const coalescer = createCoalescer({
      quietMs: 250,
      timer,
      flush: ids => { batches.push([...ids].sort()) },
    })
    coalescer.changed('s1')
    coalescer.changed('s2')
    coalescer.changed('s1')
    expect(scheduled).toHaveLength(3)
    scheduled.at(-1)!()
    await Promise.resolve()
    await Promise.resolve()
    expect(batches).toEqual([['s1', 's2']])
    expect(coalescer.pending()).toBe(0)
  })

  it('un cambio durante el flush no se pierde', async () => {
    const scheduled: (() => void)[] = []
    const timer: Timer = { set: fn => { scheduled.push(fn); return scheduled.length }, clear: () => {} }
    const batches: string[][] = []
    let coalescer: { changed(id: string): void }
    coalescer = createCoalescer({
      quietMs: 1,
      timer,
      flush: ids => {
        batches.push([...ids])
        if (batches.length === 1) coalescer.changed('s3')
      },
    })
    coalescer.changed('s1')
    scheduled.at(-1)!()
    await new Promise(resolve => setTimeout(resolve, 0))
    scheduled.at(-1)!()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(batches).toEqual([['s1'], ['s3']])
  })
})
