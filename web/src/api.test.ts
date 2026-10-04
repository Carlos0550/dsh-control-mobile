import { describe, expect, it, vi } from 'vitest'
import { createApi } from './api.ts'

describe('createApi', () => {
  it('pide la flota a la ruta relativa y devuelve el JSON', async () => {
    const calls: string[] = []
    const fake = vi.fn(async (url: string) => {
      calls.push(url)
      return new Response(JSON.stringify({ asOf: 1, agents: [], attention: [], workspaces: [], truncated: false, access: { mode: 'loopback', declared: true } }), { status: 200 })
    })
    const api = createApi(fake as never)
    const fleet = await api.fleet()
    expect(calls).toEqual(['./api/fleet'])
    expect(fleet.asOf).toBe(1)
  })

  it('lanza con el estado cuando la respuesta no es ok', async () => {
    const fake = vi.fn(async () => new Response('', { status: 401 }))
    const api = createApi(fake as never)
    await expect(api.fleet()).rejects.toThrow('401')
  })

  it('manda la decisión de atención en el cuerpo', async () => {
    const bodies: unknown[] = []
    const fake = vi.fn(async (_url: string, init?: { body?: string }) => {
      bodies.push(JSON.parse(init?.body ?? '{}'))
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    await createApi(fake as never).decide('att-1', 'allow')
    expect(bodies).toEqual([{ outcome: 'allow' }])
  })
})
