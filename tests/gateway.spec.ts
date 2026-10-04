import { describe, expect, it } from 'vitest'
import type { Delta } from '../src/types.ts'
import { mountGateway } from '../src/gateway.ts'

function fakeResponse() {
  const captured = { status: 0, body: '', headers: {} as Record<string, string> }
  const res = {
    writeHead: (status: number, headers?: Record<string, string>) => {
      captured.status = status
      if (headers !== undefined) Object.assign(captured.headers, headers)
      return res
    },
    end: (body?: string) => { captured.body = body ?? '' },
    write: () => true,
    setHeader: (name: string, value: string) => { captured.headers[name] = value },
  }
  return { res, captured }
}

function harness(admission: unknown = { peer: {} }) {
  const routes = new Map<string, (req: never, res: never) => void | Promise<void>>()
  const deltas: unknown[] = []
  const ctx = {
    connection: { admit: () => admission },
    webServer: {
      register: (route: { path: string; kind: string; handler: (req: never, res: never) => void | Promise<void> }) => {
        routes.set(`${route.kind}:${route.path}`, route.handler)
        return () => {}
      },
    },
    on: () => () => {},
  }
  const mounted = mountGateway({
    ctx: ctx as never,
    config: { path: '/mission', fleetLimit: 200, hotWindowMs: 300_000, publicHost: '' },
    port: {} as never,
    attention: { list: () => [], count: () => 0, decide: () => false, mount: () => () => {}, hold: async () => 'unavailable' },
    hub: { subscribe: (l: (d: Delta) => void) => { deltas.push(l); return () => {} }, publish: () => {}, subscribers: () => 1 },
    snapshot: async () => ({ asOf: 1, agents: [], attention: [], workspaces: [], truncated: false, access: { mode: 'loopback', declared: true } }),
    root: '/tmp/no-existe',
    access: { describe: () => ({ mode: 'loopback', declared: true }), loginUrl: () => undefined },
  })
  mounted()
  return { routes, ctx }
}

const call = async (handler: (req: never, res: never) => void | Promise<void>, req: unknown) => {
  const { res, captured } = fakeResponse()
  await handler(req as never, res as never)
  return captured
}

describe('mountGateway', () => {
  it('registra el índice, los estáticos y la API', () => {
    const { routes } = harness()
    expect([...routes.keys()].sort()).toEqual([
      'exact:/mission', 'prefix:/mission/api', 'prefix:/mission/assets',
    ])
  })

  it('rechaza con el estado que devuelve admit', async () => {
    const { routes } = harness({ rejection: 401 })
    const captured = await call(routes.get('prefix:/mission/api')!, { method: 'GET', url: '/mission/api/fleet' })
    expect(captured.status).toBe(401)
  })

  it('sirve el snapshot de flota en JSON', async () => {
    const { routes } = harness()
    const captured = await call(routes.get('prefix:/mission/api')!, { method: 'GET', url: '/mission/api/fleet' })
    expect(captured.status).toBe(200)
    expect(captured.headers['content-type']).toContain('application/json')
    expect(JSON.parse(captured.body)).toMatchObject({ asOf: 1, agents: [] })
  })

  it('devuelve 404 en una ruta de API desconocida', async () => {
    const { routes } = harness()
    const captured = await call(routes.get('prefix:/mission/api')!, { method: 'GET', url: '/mission/api/nope' })
    expect(captured.status).toBe(404)
  })
})
