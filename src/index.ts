/**
 * dsh-mission-control — remote mission control for DeepSeek Harness.
 * @module dsh-mission-control
 */
import type { Context } from '@deepseek-ai/cordis'
import { Config } from './config.ts'
import { buildFleet } from './fleet.ts'
import { createHub, createCoalescer } from './live.ts'
import { createAttention } from './attention.ts'
import { createAccess } from './access.ts'
import { createDshHelpers, createDshPort } from './adapters/dsh.ts'
import { createActions } from './actions.ts'
import { mountGateway } from './gateway.ts'

export { Config, type Config as MissionControlConfig } from './config.ts'

/** Stable Cordis plugin name. */
export const name = 'dsh-mission-control'

/** Services this plugin needs before it can mount. */
export const inject = ['webServer', 'connection']

/**
 * Mount the mission control surface.
 * @param ctx - host context carrying webServer and connection.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(async () => {
    // R13: compose port with async helpers
    const helpers = await createDshHelpers(ctx as never, { hotWindowMs: config.hotWindowMs })
    const port = createDshPort(ctx as never, helpers)

    // Create hub and attention
    const hub = createHub()
    const attention = createAttention({
      emit: (delta) => hub.publish(delta),
      now: () => Date.now(),
      id: () => crypto.randomUUID(),
      sessionIdOf: (agent) => port.sessionIdOf(agent as never),
    })

    // R23: derive trustedHosts from connection.requestRejection
    const trustedHosts = config.publicHost === ''
      ? []
      : ((ctx as never as { connection: { requestRejection(request: unknown): number | undefined } }).connection.requestRejection({ headers: { host: config.publicHost } }) !== 403 ? [config.publicHost] : [])

    // Build access service
    const access = createAccess({
      port: (ctx as never as { webServer: { port: number } }).webServer.port,
      publicHost: config.publicHost,
      authenticatedUrl: (u: string) => (ctx as never as { connection: { authenticatedUrl(baseUrl: string): string } }).connection.authenticatedUrl(u),
      trustedHosts,
    })

    // Snapshot function shared by gateway and coalescer
    const snapshot = async () => {
      const ac = new AbortController()
      const sessions = await port.facts(ac.signal)
      const report = access.describe()
      return buildFleet({
        sessions,
        attention,
        workspaces: port.workspaces(),
        access: { mode: report.mode, ...(report.hostname === undefined ? {} : { hostname: report.hostname }), declared: report.declared },
        limit: config.fleetLimit,
        asOf: Date.now(),
      })
    }

    // Create coalescer with non-throwing flush
    const coalescer = createCoalescer({
      quietMs: 250,
      async flush(ids: ReadonlySet<string>) {
        const snap = await snapshot()
        const byId = new Map(snap.agents.map(a => [a.sessionId, a]))
        for (const id of ids) {
          const agent = byId.get(id)
          if (agent !== undefined) {
            hub.publish({ t: 'agent.upsert', agent })
          }
        }
      },
    })

    // Subscribe session events to coalescer
    const unsubscribeSessionEvents = port.watchSessionEvents((id) => {
      coalescer.changed(id)
    })

    // Mount attention and gateway
    const unsubscribeAttention = attention.mount(ctx)
    const actions = createActions(port)
    const unsubscribeGateway = mountGateway({
      ctx: ctx as never,
      config,
      port,
      actions,
      attention,
      hub,
      snapshot,
      root: (await import('url')).fileURLToPath(new URL('..', import.meta.url)),
      access,
    })

    // Cleanup on unload
    return () => {
      unsubscribeSessionEvents()
      unsubscribeGateway()
      unsubscribeAttention()
      coalescer.dispose()
    }
  })

  console.log(`mission-control: mounted at ${config.path}`)
}
