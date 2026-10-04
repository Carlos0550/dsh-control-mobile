/**
 * dsh-mission-control — remote mission control for DeepSeek Harness.
 * @module dsh-mission-control
 */
import type { Context } from '@deepseek-ai/cordis'
import { Config } from './config.ts'

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
  console.log(`mission-control: mounted at ${config.path}`)
}
