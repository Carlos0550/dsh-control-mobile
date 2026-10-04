import z from '@deepseek-ai/schemastery'

/** Plugin configuration. */
export interface Config {
  /** URL prefix every route of this plugin lives under. */
  path: string
  /** Maximum number of agents in one fleet snapshot. */
  fleetLimit: number
  /** How recently a session must have moved to receive full metrics, in milliseconds. */
  hotWindowMs: number
  /** Hostname the harness is reached by; empty means loopback. */
  publicHost: string
}

export const Config = z.object({
  path: z.string().default('/mission'),
  fleetLimit: z.natural().default(200),
  hotWindowMs: z.natural().default(300_000),
  publicHost: z.string().default(''),
})
