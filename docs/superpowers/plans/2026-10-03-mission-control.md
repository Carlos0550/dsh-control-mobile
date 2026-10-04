# Mission Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir `dsh-mission-control`, un plugin de DeepSeek Harness que añade una aplicación web propia —servida por el propio harness y autenticada con su cookie— para supervisar y controlar desde el teléfono los agentes que corren en el equipo.

**Architecture:** Un paquete externo instalado en el perfil `web` (como `dsh-notification`), con una cara host que registra rutas bajo `/mission` en `ctx.webServer`, las admite con `ctx.connection.admit()` y sirve una página estática propia. La cara host lee la flota con `ctx.sessionController`, `ctx.subagents` y `ctx.tokenMeter`, escucha `session/event` para los deltas, y se registra como answerer de `approval/request` y `user-questions/request` para desbloquear agentes. Todo el acoplamiento al harness vive en `src/adapters/dsh.ts`.

**Tech Stack:** TypeScript ESM, Node ≥ 22.19, Cordis (plugins), schemastery (`z`) para config, esbuild para el bundle del host, Vite + React 18 para la página, vitest para pruebas. Sin framework de servidor: se usan las rutas de `ctx.webServer`.

**Spec:** `dsh-mission-control/docs/superpowers/specs/2026-10-03-mission-control-design.md`

## Global Constraints

- Versión de DSH objetivo: **0.2.0-rc.2** (checkout en `/home/carlos/Escritorio/deepseek-harness`). Anotarla en el README.
- Node: `^22.19.0 || >=24.0.0`. Paquete ESM (`"type": "module"`).
- **Ningún archivo fuera de `src/adapters/dsh.ts` importa o lee servicios de DSH.** El resto depende solo de los tipos de `src/types.ts`.
- **Toda ruta bajo `/mission` llama a `ctx.connection.admit(request)` antes de cualquier efecto.** Sin cookie válida: 401. Autoridad no confiable: 403.
- **El plugin no implementa TLS ni autenticación propias**, y no arranca ni para Tailscale.
- Nada de adjuntos, render rico de tool calls, diffs, edición de cola ni gestión de workspaces.
- Todo valor que cruce la frontera debe ser JSON sin pérdida (sin `undefined` en arrays, sin `BigInt`, sin ciclos).
- Commits en inglés, Conventional Commits (`feat:`, `test:`, `docs:`, `chore:`).
- Los pasos que ejecutan pruebas o crean commits los ejecuta el controlador, nunca un subagente implementador.

## Nota de refinamiento del spec

Durante la escritura de este plan se refinó **una** interfaz respecto al spec, y el spec ya está actualizado y commiteado:

- La reducción de cambios de flota no es un reductor incremental sobre el log, sino una **re-coalescencia más un snapshot recalculado** (tarea 3 más tarea 7). El efecto que pide el spec —que un evento de sesión se convierta en `agent.upsert`— se cumple igual, y la prueba del "reductor contra un log grabado" de §11 del spec se sustituye por la prueba del coalescedor más la del constructor de flota.
- La ruta `GET /mission/api/sessions/:id/transcript` **se sustituye** por `GET /mission/api/sessions/:id/stream`, que envuelve el `follow` de `ctx.sessionController`. El motivo es que `follow` ya entrega el snapshot del historial y las entradas vivas por la misma corriente, así que mantener una ruta de historial aparte obligaba a llevar dos contabilidades del mismo log.

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `package.json` | Manifiesto del paquete: exports, `dsh.bundle.patch`, scripts de build y test. |
| `dsh.plugin.json` | Declaración de plugin que lee el gestor de plugins del harness. |
| `cordis.patch.yml` | Inserta la fila del plugin al instalarse como bundle. |
| `tsconfig.json` | Compilación estricta del host, salida en `lib/`. |
| `vitest.config.ts` | Runner de pruebas del paquete. |
| `build.mjs` | Bundle del host con esbuild a `lib/index.js`. |
| `src/config.ts` | Esquema de configuración del plugin (`z`). |
| `src/types.ts` | `AgentCard`, `AttentionItem`, `TranscriptEntry`, `FleetSnapshot`, `Delta` y las interfaces de puerto. |
| `src/adapters/dsh.ts` | **Único** módulo que toca servicios del harness. |
| `src/fleet.ts` | Snapshot agregado y métricas en dos niveles. |
| `src/live.ts` | `session/event` → `Delta` → fan-out a suscriptores. |
| `src/attention.ts` | Registro de peticiones pendientes y answerers. |
| `src/actions.ts` | `prompt`, `create`, `interrupt`. |
| `src/access.ts` | Diagnóstico de exposición y URL de login para el QR. |
| `src/gateway.ts` | Rutas, admisión, estáticos, SSE y el índice del plugin. |
| `web/` | Aplicación Vite de la página: vistas, componentes y cliente de API. |
| `tests/` | Pruebas del host. |
| `README.md` | Instalación, build, exposición y smoke manual. |

---

### Task 1: Andamiaje instalable del plugin

**Files:**
- Create: `package.json`, `dsh.plugin.json`, `cordis.patch.yml`, `tsconfig.json`, `vitest.config.ts`, `build.mjs`, `src/config.ts`, `src/index.ts`
- Test: `tests/plugin.spec.ts`

**Depends on:** none

**Interfaces:**
- Consumes: nothing.
- Produces: `name: 'dsh-mission-control'`, `inject: ['webServer', 'connection']`, `apply(ctx, config)`, and `Config` with `path`, `fleetLimit`, `hotWindowMs`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/plugin.spec.ts
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { apply, Config, inject, name } from '../src/index.ts'

describe('plugin manifest', () => {
  it('declares the bundle patch and the plugin entry', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    const manifest = JSON.parse(await readFile(new URL('../dsh.plugin.json', import.meta.url), 'utf8'))
    expect(pkg.name).toBe('dsh-mission-control')
    expect(pkg.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.entry.name).toBe('dsh-mission-control')
    expect(manifest.entry.inject).toEqual(['webServer', 'connection'])
  })

  it('exposes the cordis plugin surface and its defaults', () => {
    expect(name).toBe('dsh-mission-control')
    expect(inject).toEqual(['webServer', 'connection'])
    expect(typeof apply).toBe('function')
    expect(Config({}).path).toBe('/mission')
    expect(Config({ path: '/otro' }).path).toBe('/otro')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/plugin.spec.ts`
Expected: FAIL — cannot resolve `../src/index.ts`.

- [ ] **Step 3: Write the manifest and the plugin entry**

```json
// package.json
{
  "name": "dsh-mission-control",
  "version": "0.1.0",
  "description": "Remote mission control for DeepSeek Harness: supervise and steer your agents from a phone.",
  "license": "MIT",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./package.json": "./package.json"
  },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "files": ["lib", "web-dist", "cordis.patch.yml", "dsh.plugin.json", "README.md"],
  "scripts": {
    "build": "node build.mjs",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "check": "pnpm run typecheck && pnpm run test && pnpm run build"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "*",
    "@deepseek-ai/dsh-api-session-controller": "*",
    "@deepseek-ai/dsh-client-connection": "*",
    "@deepseek-ai/dsh-host-webserver": "*",
    "@deepseek-ai/dsh-session": "*",
    "@deepseek-ai/dsh-subagent": "*",
    "@deepseek-ai/dsh-token-meter": "*",
    "@deepseek-ai/dsh-user-approval": "*",
    "@deepseek-ai/dsh-user-questions": "*",
    "@deepseek-ai/schemastery": "*",
    "react": "^18.2.0"
  },
  "peerDependenciesMeta": {
    "@deepseek-ai/dsh-api-session-controller": { "optional": true },
    "@deepseek-ai/dsh-client-connection": { "optional": true },
    "@deepseek-ai/dsh-host-webserver": { "optional": true },
    "@deepseek-ai/dsh-session": { "optional": true },
    "@deepseek-ai/dsh-subagent": { "optional": true },
    "@deepseek-ai/dsh-token-meter": { "optional": true },
    "@deepseek-ai/dsh-user-approval": { "optional": true },
    "@deepseek-ai/dsh-user-questions": { "optional": true },
    "react": { "optional": true }
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "link:../../deepseek-harness/vendor/cordis",
    "@deepseek-ai/dsh-api-session-controller": "link:../../deepseek-harness/packages/api/session-controller",
    "@deepseek-ai/dsh-client-connection": "link:../../deepseek-harness/packages/client/connection",
    "@deepseek-ai/dsh-host-webserver": "link:../../deepseek-harness/packages/host/webserver",
    "@deepseek-ai/dsh-session": "link:../../deepseek-harness/packages/core/session",
    "@deepseek-ai/dsh-subagent": "link:../../deepseek-harness/packages/subagent/subagent",
    "@deepseek-ai/dsh-token-meter": "link:../../deepseek-harness/packages/llm/token-meter",
    "@deepseek-ai/dsh-user-approval": "link:../../deepseek-harness/packages/interaction/user-approval",
    "@deepseek-ai/dsh-user-questions": "link:../../deepseek-harness/packages/interaction/user-questions",
    "@deepseek-ai/schemastery": "link:../../deepseek-harness/vendor/schemastery",
    "@types/node": "^24.0.0",
    "esbuild": "^0.25.0",
    "typescript": "^6.0.3",
    "vitest": "^4.1.8"
  }
}
```

```json
// dsh.plugin.json
{
  "name": "dsh-mission-control",
  "description": "Remote mission control for DeepSeek Harness",
  "version": "0.1.0",
  "entry": { "name": "dsh-mission-control", "inject": ["webServer", "connection"] }
}
```

```yaml
# cordis.patch.yml
# Mount the host plugin under its package name, resolved through the profile's node_modules.
- insert:
    - id: dsh-mission-control
      name: dsh-mission-control
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src", "tests", "build.mjs"]
}
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['tests/**/*.spec.ts'] } })
```

```js
// build.mjs
import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: false,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
})
```

```ts
// src/config.ts
import z from '@deepseek-ai/schemastery'

/** Plugin configuration. */
export interface Config {
  /** URL prefix every route of this plugin lives under. */
  path: string
  /** Maximum number of agents in one fleet snapshot. */
  fleetLimit: number
  /** How recently a session must have moved to receive full metrics, in milliseconds. */
  hotWindowMs: number
}

export const Config: z<Config> = z.object({
  path: z.string().default('/mission'),
  fleetLimit: z.natural().default(200),
  hotWindowMs: z.natural().default(300_000),
})
```

```ts
// src/index.ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm install && pnpm vitest run tests/plugin.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Build and commit**

```bash
pnpm run typecheck && pnpm run build && test -f lib/index.js
git add -A
git commit -m "feat: scaffold the dsh-mission-control plugin package"
```

---

### Task 2: Tipos y constructor de la flota

**Files:**
- Create: `src/types.ts`, `src/fleet.ts`
- Test: `tests/fleet.spec.ts`

**Depends on:** Task 1

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - Tipos `AgentState`, `AgentCard`, `AttentionItem`, `TranscriptEntry`, `FleetSnapshot`, `Delta`, `SessionFacts`.
  - `interface AttentionSource { list(): readonly AttentionItem[] }`.
  - `buildFleet(input: BuildFleetInput): FleetSnapshot` con `BuildFleetInput = { sessions: readonly SessionFacts[]; attention: AttentionSource; workspaces: readonly string[]; access: FleetSnapshot['access']; limit: number; asOf: number }`.
  - `orderAgents(sessions: readonly SessionFacts[]): SessionFacts[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/fleet.spec.ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/fleet.spec.ts`
Expected: FAIL — cannot resolve `../src/fleet.ts`.

- [ ] **Step 3: Write the types**

```ts
// src/types.ts
/** Lifecycle state of one agent as the cockpit shows it. */
export type AgentState = 'idle' | 'running' | 'waiting-approval' | 'waiting-answer' | 'error'

/** One renderable line of a conversation. */
export interface TranscriptEntry {
  seq: number
  kind: 'user' | 'assistant' | 'tool' | 'system' | 'error'
  text?: string
  tool?: { name: string; status: 'ok' | 'error' | 'running'; summary: string }
  at: number
  streaming?: boolean
}

/** One thing waiting for the operator. */
export interface AttentionItem {
  id: string
  kind: 'approval' | 'question' | 'error'
  sessionId: string
  since: number
  summary: string
  detail?: {
    toolName?: string
    reason?: string
    questions?: { id: string; header?: string; question: string; options?: { label: string }[] }[]
  }
}

/** One agent row of the board. */
export interface AgentCard {
  sessionId: string
  parentSessionId?: string
  depth: number
  kind: 'root' | 'subagent'
  title: string
  workspace: string
  model?: string
  state: AgentState
  metrics: {
    tokensPerSecond?: number
    context?: { used: number; window: number; percent: number }
    lastActivityAt: number
    turnStartedAt?: number
  }
  lastLine?: string
  promptable: boolean
}

/** Complete board state. */
export interface FleetSnapshot {
  asOf: number
  agents: AgentCard[]
  attention: AttentionItem[]
  workspaces: string[]
  truncated: boolean
  access: { mode: 'tailnet' | 'public' | 'loopback'; hostname?: string; declared: boolean }
}

/** One incremental board or transcript change. */
export type Delta =
  | { t: 'agent.upsert'; agent: AgentCard }
  | { t: 'agent.remove'; sessionId: string }
  | { t: 'attention.open'; item: AttentionItem }
  | { t: 'attention.close'; id: string }
  | { t: 'transcript.append'; sessionId: string; entry: TranscriptEntry }
  | { t: 'access'; access: FleetSnapshot['access'] }
  | { t: 'heartbeat'; at: number }

/** What the harness tells us about one session, already flattened. */
export interface SessionFacts {
  sessionId: string
  parentSessionId?: string
  kind: 'root' | 'subagent'
  title: string
  workspace: string
  running: boolean
  agentAvailable: boolean
  updatedAt: number
  model?: string
  context?: { used: number; window: number }
  tokensPerSecond?: number
  lastLine?: string
  waiting?: 'approval' | 'question'
  errored?: boolean
}

/** Read side of the pending-attention registry. */
export interface AttentionSource {
  list(): readonly AttentionItem[]
}
```

- [ ] **Step 4: Write the fleet builder**

```ts
// src/fleet.ts
import type { AgentCard, AgentState, AttentionItem, AttentionSource, FleetSnapshot, SessionFacts } from './types.ts'

/** Inputs of one fleet snapshot. */
export interface BuildFleetInput {
  sessions: readonly SessionFacts[]
  attention: AttentionSource
  workspaces: readonly string[]
  access: FleetSnapshot['access']
  limit: number
  asOf: number
}

/** Rank of one agent: what waits for the operator leads. */
function rank(session: SessionFacts): number {
  if (session.waiting !== undefined) return 0
  if (session.errored === true) return 1
  if (session.running) return 2
  return 3
}

/** Depth of one session in its parent chain, 0 for a root. */
function depthOf(session: SessionFacts, byId: ReadonlyMap<string, SessionFacts>): number {
  let depth = 0
  let cursor = session.parentSessionId
  const seen = new Set<string>([session.sessionId])
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor)
    depth += 1
    cursor = byId.get(cursor)?.parentSessionId
  }
  return depth
}

/**
 * Order sessions so the board reads top-down: the group that needs the operator
 * first, then by recent activity, with every child immediately after its parent.
 * @param sessions - flattened session facts.
 * @returns a new array in board order.
 */
export function orderAgents(sessions: readonly SessionFacts[]): SessionFacts[] {
  const byId = new Map(sessions.map(s => [s.sessionId, s]))
  const rootOf = (session: SessionFacts): string => {
    let cursor = session
    const seen = new Set<string>([session.sessionId])
    while (cursor.parentSessionId !== undefined && !seen.has(cursor.parentSessionId)) {
      const parent = byId.get(cursor.parentSessionId)
      if (parent === undefined) break
      seen.add(parent.sessionId)
      cursor = parent
    }
    return cursor.sessionId
  }
  const groups = new Map<string, SessionFacts[]>()
  for (const session of sessions) {
    const key = rootOf(session)
    const bucket = groups.get(key)
    if (bucket === undefined) groups.set(key, [session])
    else bucket.push(session)
  }
  const ordered: SessionFacts[] = []
  const ranked = [...groups.values()].map(members => ({
    members,
    best: Math.min(...members.map(rank)),
    recent: Math.max(...members.map(m => m.updatedAt)),
  }))
  ranked.sort((a, b) => a.best - b.best || b.recent - a.recent || a.members[0]!.sessionId.localeCompare(b.members[0]!.sessionId))
  for (const group of ranked) {
    group.members.sort((a, b) =>
      depthOf(a, byId) - depthOf(b, byId) || b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId))
    ordered.push(...group.members)
  }
  return ordered
}

/** State of one session given the attention it currently owns. */
function stateOf(session: SessionFacts): AgentState {
  if (session.waiting === 'approval') return 'waiting-approval'
  if (session.waiting === 'question') return 'waiting-answer'
  if (session.errored === true) return 'error'
  if (session.running) return 'running'
  return 'idle'
}

/**
 * Build the complete board state.
 * @param input - facts, attention, workspaces, access and limits.
 * @returns the snapshot the page renders.
 */
export function buildFleet(input: BuildFleetInput): FleetSnapshot {
  const byId = new Map(input.sessions.map(s => [s.sessionId, s]))
  const attention = input.attention.list()
  const ordered = orderAgents(input.sessions)
  const kept = ordered.slice(0, input.limit)
  const agents: AgentCard[] = kept.map(session => {
    const context = session.context === undefined
      ? undefined
      : {
          used: session.context.used,
          window: session.context.window,
          percent: session.context.window === 0
            ? 0
            : Math.min(100, Math.round(session.context.used / session.context.window * 100)),
        }
    return {
      sessionId: session.sessionId,
      ...session.parentSessionId === undefined ? {} : { parentSessionId: session.parentSessionId },
      depth: depthOf(session, byId),
      kind: session.kind,
      title: session.title,
      workspace: session.workspace,
      ...session.model === undefined ? {} : { model: session.model },
      state: stateOf(session),
      metrics: {
        ...session.tokensPerSecond === undefined ? {} : { tokensPerSecond: session.tokensPerSecond },
        ...context === undefined ? {} : { context },
        lastActivityAt: session.updatedAt,
      },
      ...session.lastLine === undefined ? {} : { lastLine: session.lastLine },
      promptable: session.kind === 'root' || session.agentAvailable,
    }
  })
  const visible = new Set(agents.map(a => a.sessionId))
  const attention2 = attention.filter(item => visible.has(item.sessionId))
  return {
    asOf: input.asOf,
    agents,
    attention: [...attention2],
    workspaces: [...input.workspaces],
    truncated: ordered.length > agents.length,
    access: input.access,
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run tests/fleet.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/fleet.ts tests/fleet.spec.ts
git commit -m "feat: add fleet types and the board ordering builder"
```

---


### Task 3: Hub de deltas y coalescencia de eventos

**Files:**
- Create: `src/live.ts`
- Test: `tests/live.spec.ts`

**Depends on:** Task 1

**Interfaces:**
- Consumes: `Delta` de `src/types.ts` (Task 2).
- Produces: `createHub(): DeltaHub` con `subscribe(publish) => unsubscribe`, `publish(delta)`, `subscribers()`; `createCoalescer({ quietMs, flush, timer? }): Coalescer` con `changed(sessionId)`, `pending()`, `dispose()`; y `interface Timer { set(fn, ms): unknown; clear(handle): void }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/live.spec.ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/live.spec.ts`
Expected: FAIL — cannot resolve `../src/live.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// src/live.ts
import type { Delta } from './types.ts'

/** Fan-out of deltas to every connected page. */
export interface DeltaHub {
  subscribe(listener: (delta: Delta) => void): () => void
  publish(delta: Delta): void
  subscribers(): number
}

/**
 * Create a hub where one broken subscriber never silences the others.
 * @returns the hub.
 */
export function createHub(): DeltaHub {
  const listeners = new Set<(delta: Delta) => void>()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    publish(delta) {
      for (const listener of [...listeners]) {
        try {
          listener(delta)
        } catch {
          // A closed socket is not a reason to stop serving the others.
        }
      }
    },
    subscribers: () => listeners.size,
  }
}

/** Timer seam, so tests drive the quiet period without fake timers. */
export interface Timer {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const systemTimer: Timer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => { clearTimeout(handle as ReturnType<typeof setTimeout>) },
}

/** Coalesces a burst of session changes into as few flushes as possible. */
export interface Coalescer {
  changed(sessionId: string): void
  pending(): number
  dispose(): void
}

/**
 * Create a coalescer that waits for quiet before flushing dirty session ids.
 * @param options - quiet period, flush callback, and the timer seam.
 * @returns the coalescer.
 */
export function createCoalescer(options: {
  quietMs: number
  flush: (ids: ReadonlySet<string>) => Promise<void> | void
  timer?: Timer
}): Coalescer {
  const timer = options.timer ?? systemTimer
  const dirty = new Set<string>()
  let handle: unknown
  let running = false
  const run = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      while (dirty.size > 0) {
        const batch = new Set(dirty)
        dirty.clear()
        await options.flush(batch)
      }
    } finally {
      running = false
    }
  }
  return {
    changed(sessionId) {
      dirty.add(sessionId)
      if (handle !== undefined) timer.clear(handle)
      handle = timer.set(() => {
        handle = undefined
        void run()
      }, options.quietMs)
    },
    pending: () => dirty.size,
    dispose() {
      if (handle !== undefined) {
        timer.clear(handle)
        handle = undefined
      }
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/live.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/live.ts tests/live.spec.ts
git commit -m "feat: add the delta hub and the session-change coalescer"
```

---

### Task 4: Fijar el ámbito del answerer de aprobaciones

**Files:**
- Create: `tests/answerer-scope.spec.ts`
- Modify: `package.json` (añadir `@deepseek-ai/dsh-scope` a devDependencies y peerDependencies)

**Depends on:** Task 1

**Interfaces:**
- Consumes: `@deepseek-ai/cordis` y `@deepseek-ai/dsh-scope`.
- Produces: la decisión verificada de que un answerer registrado en la raíz recibe los despachos con ámbito de agente. Las tareas 5 y 6 dependen de ella.

**Contexto:** el harness despacha `approval/request` con `this.ctx.waterfall(scopeTarget(req.agent, req.agent), 'approval/request', req, () => 'unavailable')` (`packages/interaction/user-approval/src/index.ts`). `scopeTarget` construye un *carrier* con un filtro, y ese filtro devuelve `true` cuando el contexto del listener no tiene etiqueta de ámbito (`packages/core/scope/src/index.ts:176`). Esta tarea lo fija con una prueba, porque de ello depende que el cockpit pueda desbloquear agentes sin navegador.

- [ ] **Step 1: Write the failing test**

```ts
// tests/answerer-scope.spec.ts
import { Context } from '@deepseek-ai/cordis'
import { "@deepseek-ai/dsh-scope" } from "@deepseek-ai/dsh-scope"
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/answerer-scope.spec.ts`
Expected: FAIL — cannot resolve `@deepseek-ai/dsh-scope`.

- [ ] **Step 3: Add the dependency and fix the import name**

Añade `"@deepseek-ai/dsh-scope": "link:../../deepseek-harness/packages/core/scope"` a `devDependencies` y la misma entrada a `peerDependencies` con `"optional": true` en `peerDependenciesMeta`, luego `pnpm install`. Si el nombre exportado no coincide, ajústalo en el import de la prueba.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/answerer-scope.spec.ts`
Expected: PASS (2 tests). Si el primero falla, **para y repórtalo**: significa que el answerer debe registrarse por agente y las tareas 5 y 6 cambian.

- [ ] **Step 5: Commit**

```bash
git add package.json tests/answerer-scope.spec.ts pnpm-lock.yaml
git commit -m "test: pin that a root answerer receives agent-scoped approval waterfalls"
```

---


### Task 5: Registro de atención y answerers

**Files:**
- Create: `src/attention.ts`
- Test: `tests/attention.spec.ts`

**Depends on:** Task 2 (tipos), Task 4 (ámbito verificado)

**Interfaces:**
- Consumes: `AttentionItem`, `AttentionSource`, `Delta` de `src/types.ts`.
- Produces: `createAttention(deps): AttentionService` donde `deps = { emit(delta): void; now(): number; id(): string; sessionIdOf(agent: unknown): string }` y `AttentionService = AttentionSource & { mount(ctx): () => void; decide(id, 'allow' | 'deny'): boolean; count(): number }`. También exporta `type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`.

**Contexto:** el evento `approval/request` trae `agent`, `toolName`, `reason`, `signal` y una continuación `next()` (`packages/interaction/user-approval/src/types.ts:63-92`). Devolver un outcome reclama la petición; llamar a `next()` la delega. Si el `signal` aborta, la petición se cierra como `'cancelled'`. La sesión se obtiene con `sessionIdOf(req.agent)`, inyectado, para que este módulo no toque DSH.

- [ ] **Step 1: Write the failing test**

```ts
// tests/attention.spec.ts
import { describe, expect, it } from 'vitest'
import { createAttention } from '../src/attention.ts'
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
    let resolveRequest: ((outcome: string) => void) | undefined
    const pending = new Promise<string>(resolve => { resolveRequest = resolve })
    const outcome = attention.hold({ agent: {} }, { toolName: 'bash', reason: 'rm -rf dist' }, () => pending)
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
    const outcome = await attention.hold({ agent: {} }, { toolName: 'bash', signal: controller.signal }, () => new Promise(() => {}))
    expect(outcome).toBe('cancelled')
    expect(attention.count()).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/attention.spec.ts`
Expected: FAIL — cannot resolve `../src/attention.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// src/attention.ts
import type { Context } from '@deepseek-ai/cordis'
import type { AttentionItem, AttentionSource, Delta } from './types.ts'

/** Outcomes the harness accepts for one approval request. */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** Minimal shape of the approval request this module consumes. */
interface ApprovalRequestLike {
  agent: unknown
  toolName: string
  reason?: string
  signal?: AbortSignal
}

/** Pending-request registry, readable by the board and answerable by the page. */
export interface AttentionService extends AttentionSource {
  mount(ctx: Context): () => void
  hold(request: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>
  decide(id: string, decision: 'allow' | 'deny'): boolean
  count(): number
}

/**
 * Create the attention registry.
 * @param deps - delta sink, clock, id source, and the agent-to-session accessor.
 * @returns the service.
 */
export function createAttention(deps: {
  emit: (delta: Delta) => void
  now: () => number
  id: () => string
  sessionIdOf: (agent: unknown) => string
}): AttentionService {
  const pending = new Map<string, { item: AttentionItem; settle: (outcome: ApprovalOutcome) => void }>()
  const close = (id: string): void => {
    pending.delete(id)
    deps.emit({ t: 'attention.close', id })
  }
  return {
    list: () => [...pending.values()].map(entry => entry.item),
    count: () => pending.size,
    decide(id, decision) {
      const entry = pending.get(id)
      if (entry === undefined) return false
      close(id)
      entry.settle(decision === 'allow' ? 'allowed-once' : 'rejected')
      return true
    },
    async hold(request, next) {
      if (request.signal?.aborted === true) return 'cancelled'
      const id = deps.id()
      const item: AttentionItem = {
        id,
        kind: 'approval',
        sessionId: deps.sessionIdOf(request.agent),
        since: deps.now(),
        summary: request.reason ?? request.toolName,
        detail: {
          toolName: request.toolName,
          ...request.reason === undefined ? {} : { reason: request.reason },
        },
      }
      const settled = Promise.withResolvers<ApprovalOutcome>()
      pending.set(id, { item, settle: settled.resolve })
      deps.emit({ t: 'attention.open', item })
      if (request.signal === undefined) return await settled.promise
      return await new Promise<ApprovalOutcome>(resolve => {
        const onAbort = (): void => {
          if (pending.has(id)) close(id)
          resolve('cancelled')
        }
        request.signal!.addEventListener('abort', onAbort, { once: true })
        void settled.promise.then(outcome => {
          request.signal!.removeEventListener('abort', onAbort)
          resolve(outcome)
        })
      })
    },
    mount(ctx) {
      const listener = (request: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> =>
        this.hold(request, next)
      return ctx.on('approval/request' as never, listener as never)
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/attention.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/attention.ts tests/attention.spec.ts
git commit -m "feat: hold approval requests until the operator decides"
```

---

### Task 6: Adaptador del harness

**Files:**
- Create: `src/adapters/dsh.ts`
- Test: `tests/adapter.spec.ts`

**Depends on:** Task 2

**Interfaces:**
- Consumes: `SessionFacts`, `AttentionSource`, `FleetSnapshot` de `src/types.ts`.
- Produces: `createDshPort(deps): DshPort` donde `DshPort = { facts(signal): Promise<SessionFacts[]>; workspaces(): readonly string[]; sessionIdOf(agent): string; watchSessionEvents(handler: (sessionId: string) => void): () => void; startSession(cwd, prompt): Promise<string>; sendPrompt(sessionId, text): Promise<void>; interrupt(sessionId): Promise<void>; modelOf(sessionId): Promise<string | undefined> }`.

**Contexto y reconocimiento obligatorio antes de escribir código.** Las firmas siguientes están verificadas contra el checkout 0.2.0-rc.2; los accesores marcados con *(verificar)* hay que confirmarlos leyendo el archivo indicado antes de escribirlos:

- `ctx.sessionController.list({}, signal)` → `{ items: SessionSummary[] }`, con `sessionId`, `agentAvailable`, `updatedAt`, `running`, `blank`, `parentSessionId?`, `origin?: 'subagent'`, `cwd?` — `packages/api/session-controller/src/types.ts:177-188`.
- `ctx.sessionController.create({ cwd, agentPreset? })` → `{ sessionId }` — `types.ts:285-296`.
- `ctx.sessionController.prompt({ requestId, sessionId, mode: 'queue', content }, signal)` → `{ accepted: true }` — `types.ts:333-346`. `content` es `PromptContentPart[]`; la forma exacta del part de texto está en *(verificar)* `packages/api/session-controller/src/commands.ts`.
- `ctx.sessionController.cancel({ sessionId })` → `SessionCancelValue` — `types.ts:373`.
- `ctx.subagents.listChildren(parentSessionId, signal?)` → `Promise<SubagentCatalogEntry[]>` — `packages/subagent/subagent/src/index.ts:374`.
- `ctx.tokenMeter.measure(session)` → objeto con `totalTokens` — `packages/llm/token-meter/src/index.ts` *(verificar)* el resto de campos.
- El título de una sesión sale de una proyección, no de `SessionSummary`: confirma la clave leyendo *(verificar)* `packages/api/session-controller/src/list.ts` y `SessionProjectionHints` en `types.ts`. Si no hay título disponible, usa `sessionId.slice(0, 8)`.
- Escritura de los deltas de flota: `ctx.on('session/event', (session, event) => …)` — `packages/session/session-projection/src/index.ts:220`.

- [ ] **Step 1: Write the failing test (con un contexto de harness falso)**

```ts
// tests/adapter.spec.ts
import { describe, expect, it } from 'vitest'
import { createDshPort } from '../src/adapters/dsh.ts'

const summary = (over: Record<string, unknown>) => ({
  sessionId: 's1', agentAvailable: true, updatedAt: 10, running: true, blank: false, ...over,
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
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/adapter.spec.ts`
Expected: FAIL — cannot resolve `../src/adapters/dsh.ts`.

- [ ] **Step 3: Write the adapter**

Escribe `src/adapters/dsh.ts` implementando `createDshPort(ctx, helpers)` con estas reglas, y resuelve cada *(verificar)* leyendo el archivo indicado:

1. `facts(signal)` llama a `list`, y por cada resumen construye un `SessionFacts` con `kind: origin === 'subagent' ? 'subagent' : 'root'`, `title` desde `helpers.titleOf` con respaldo `sessionId.slice(0, 8)`, `workspace: cwd ?? '(sin workspace)'`. **Las métricas son de dos niveles (decisión D10 del spec):** calcula `context` con `tokenMeter.measure` contra `helpers.contextWindowOf(model)` **solo** para sesiones con `running === true` o `updatedAt >= Date.now() - helpers.hotWindowMs`; para el resto deja `context` sin definir. Añade una prueba que fije que una sesión fría llega sin `context`.
2. Los hijos se resuelven con `subagents.listChildren` solo para las sesiones raíz que ya aparezcan con hijos en `parentSessionId`; **no** llames a `listChildren` por cada sesión del listado.
3. `watchSessionEvents(handler)` registra `ctx.on('session/event', session => handler(session.id))` y devuelve el desuscriptor.
4. `startSession(cwd, prompt)` crea la sesión y luego llama a `sendPrompt` con el id nuevo; `sendPrompt` manda `mode: 'queue'` y un `requestId` generado con `crypto.randomUUID()`.
5. `interrupt` llama a `cancel`.
6. Nunca lances por un fallo del harness: registra con `console.error` y devuelve `undefined` o un array vacío, según el caso.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/adapter.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/dsh.ts tests/adapter.spec.ts
git commit -m "feat: add the single harness adapter"
```

---


### Task 7: Gateway, rutas y composición del plugin

**Files:**
- Create: `src/gateway.ts`
- Modify: `src/index.ts`
- Test: `tests/gateway.spec.ts`

**Depends on:** Task 2, Task 5, Task 6

**Interfaces:**
- Consumes: `buildFleet` (Task 2), `AttentionService` (Task 5), `DshPort` (Task 6), `DeltaHub` (Task 3).
- Produces: `mountGateway(deps): () => void` donde `deps = { ctx; config; port: DshPort; attention: AttentionService; hub: DeltaHub; snapshot(): Promise<FleetSnapshot>; root: string }` y `root` es el directorio del paquete resuelto con `fileURLToPath(new URL('..', import.meta.url))`.

**Firmas verificadas:** `ctx.webServer.register({ kind, path, handler })` con `path` absoluto y **sin barra final**, y `handler(req, res)` dueño del ciclo completo de respuesta (`packages/host/webserver/src/index.ts:42-48`). `ctx.connection.admit(request)` es **síncrono** y devuelve `{ peer }` o `{ rejection }` (`packages/client/connection/src/rpc-host.ts:110-113`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/gateway.spec.ts
import { describe, expect, it } from 'vitest'
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
    hub: { subscribe: (l: (d: unknown) => void) => { deltas.push(l); return () => {} }, publish: () => {}, subscribers: () => 1 },
    snapshot: async () => ({ asOf: 1, agents: [], attention: [], workspaces: [], truncated: false, access: { mode: 'loopback', declared: true } }),
    root: '/tmp/no-existe',
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/gateway.spec.ts`
Expected: FAIL — cannot resolve `../src/gateway.ts`.

- [ ] **Step 3: Write the gateway**

Escribe `src/gateway.ts` con esta estructura, y resuelve cada *(verificar)* leyendo el archivo indicado:

1. `admit(ctx, req, res): boolean` — llama a `ctx.connection.admit(req)`; si trae `rejection`, escribe `res.writeHead(typeof rejection === 'number' ? rejection : 403)` y `res.end()`, y devuelve `false`.
2. `sendJson(res, status, value)` — `content-type: application/json; charset=utf-8`, `cache-control: no-store`, y `JSON.stringify(value)`.
3. Tabla de rutas de API, despachada por `method` y `pathname`:
   - `GET /api/fleet` → `deps.snapshot()`
   - `GET /api/attention` → `deps.attention.list()`
   - `POST /api/attention/:id/decision` → cuerpo `{ outcome: 'allow' | 'deny' }`; responde `{ ok: attention.decide(id, outcome) }`, y 404 si `ok` es `false`
   - `POST /api/sessions` → `{ workspace, prompt }` → `{ sessionId: await port.startSession(workspace, prompt) }`
   - `POST /api/sessions/:id/prompt` → `{ text }` → `{ accepted: true }`
   - `POST /api/sessions/:id/interrupt` → `{ ok: true }`
   - `GET /api/stream` → SSE
   - `GET /api/sessions/:id/stream` → SSE de conversación (Task 12); hasta entonces responde 501 con `{ error: 'conversation stream not implemented' }`
   Convierte el cuerpo con `await readJson(req)` acotado a 64 KiB; si no es JSON válido, 400.
4. **SSE** (`writeEventStream`): escribe `writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' })`, se suscribe a `deps.hub`, escribe `data: ${JSON.stringify(delta)}\n\n` por delta, manda `{ t: 'heartbeat' }` cada 20 s con `setInterval`, y **limpia ambos** en `req.on('close')`.
5. **Estáticos**: sirve desde `join(deps.root, 'web-dist')`; rechaza cualquier ruta que resuelva fuera de ese directorio con 403; mime por extensión (`.html`, `.js`, `.css`, `.webmanifest`, `.svg`, `.png`); si no existe, 404. El índice se sirve también para `\`${config.path}/\`` sin barra final.
6. **Registro**: `ctx.webServer.register` para `exact` `config.path`, `prefix` `${config.path}/assets` y `prefix` `${config.path}/api`. Registra los desuscriptores en el efecto del plugin y devuélvelos desde `mountGateway`.

- [ ] **Step 4: Compón el plugin en `src/index.ts`**

Sustituye el cuerpo de `apply` por: crear el `DeltaHub`, el `DshPort`, el registro de atención, un `createCoalescer` cuyo `flush` recalcula `snapshot()` y publica `agent.upsert` por cada agente afectado, suscribir `port.watchSessionEvents` a `coalescer.changed`, montar `attention.mount(ctx)` y llamar a `mountGateway`. Registra todo dentro de `ctx.effect(() => { … })` para que descargue con el plugin. El `snapshot()` compartido es `async () => buildFleet({ sessions: await port.facts(signal), attention, workspaces: port.workspaces(), access, limit: config.fleetLimit, asOf: Date.now() })`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run tests/gateway.spec.ts && pnpm run typecheck`
Expected: PASS (4 tests) y sin errores de tipos.

- [ ] **Step 6: Commit**

```bash
git add src/gateway.ts src/index.ts tests/gateway.spec.ts
git commit -m "feat: mount the mission control routes and compose the plugin"
```

---

### Task 8: Acciones de control

**Files:**
- Create: `src/actions.ts`
- Modify: `src/gateway.ts` (usar `actions` en lugar de `port` directo)
- Test: `tests/actions.spec.ts`

**Depends on:** Task 6, Task 7

**Interfaces:**
- Consumes: `DshPort` (Task 6).
- Produces: `createActions(port: DshPort): Actions` con `Actions = { start(workspace: string, prompt: string): Promise<string>; send(sessionId: string, text: string): Promise<void>; interrupt(sessionId: string): Promise<void> }`.

**Contexto:** `sessionController.prompt` rechaza contenido sin texto no blanco, así que `send` valida antes y lanza `new Error('empty prompt')`; el gateway traduce ese error a 400 y cualquier otro a 502.

- [ ] **Step 1: Write the failing test**

```ts
// tests/actions.spec.ts
import { describe, expect, it } from 'vitest'
import { createActions } from '../src/actions.ts'

const port = (over: Record<string, unknown> = {}) => ({
  startSession: async () => 'new-1',
  sendPrompt: async () => {},
  interrupt: async () => {},
  ...over,
}) as never

describe('createActions', () => {
  it('recorta el texto antes de enviarlo', async () => {
    const sent: [string, string][] = []
    const actions = createActions(port({ sendPrompt: async (id: string, text: string) => { sent.push([id, text]) } }))
    await actions.send('s1', '  hola  ')
    expect(sent).toEqual([['s1', 'hola']])
  })

  it('rechaza un prompt vacío sin llamar al harness', async () => {
    let called = 0
    const actions = createActions(port({ sendPrompt: async () => { called += 1 } }))
    await expect(actions.send('s1', '   ')).rejects.toThrow('empty prompt')
    await expect(actions.start('/w', '')).rejects.toThrow('empty prompt')
    expect(called).toBe(0)
  })

  it('delega el arranque y la interrupción', async () => {
    const actions = createActions(port())
    expect(await actions.start('/w', 'hola')).toBe('new-1')
    await expect(actions.interrupt('s1')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/actions.spec.ts`
Expected: FAIL — cannot resolve `../src/actions.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// src/actions.ts
import type { DshPort } from './adapters/dsh.ts'

/** The three control actions the cockpit offers. */
export interface Actions {
  start(workspace: string, prompt: string): Promise<string>
  send(sessionId: string, text: string): Promise<void>
  interrupt(sessionId: string): Promise<void>
}

/**
 * Create the control actions over the harness port.
 * @param port - the harness adapter.
 * @returns the actions.
 */
export function createActions(port: DshPort): Actions {
  const requireText = (text: string): string => {
    const trimmed = text.trim()
    if (trimmed === '') throw new Error('empty prompt')
    return trimmed
  }
  return {
    start: async (workspace, prompt) => await port.startSession(workspace, requireText(prompt)),
    send: async (sessionId, text) => { await port.sendPrompt(sessionId, requireText(text)) },
    interrupt: async (sessionId) => { await port.interrupt(sessionId) },
  }
}
```

- [ ] **Step 4: Wire it into the gateway and run the tests**

En `src/gateway.ts`, sustituye las llamadas directas a `port` de las tres rutas de control por `actions`, y mapea `error.message === 'empty prompt'` a 400 y cualquier otro a 502.

Run: `pnpm vitest run && pnpm run typecheck`
Expected: PASS en toda la suite.

- [ ] **Step 5: Commit**

```bash
git add src/actions.ts src/gateway.ts tests/actions.spec.ts
git commit -m "feat: add the control actions with input validation"
```

---


### Task 9: Diagnóstico de acceso y URL de login

**Files:**
- Create: `src/access.ts`
- Modify: `src/config.ts` (añadir `publicHost`), `src/gateway.ts` (rutas `GET /api/access` y `POST /api/security/revoke`)
- Test: `tests/access.spec.ts`

**Depends on:** Task 7

**Interfaces:**
- Consumes: `ctx.connection.authenticatedUrl(url: string): string` (verificado en `packages/bundle/web-app/src/index.ts:262`), `ctx.webServer.port`.
- Produces: `createAccess(deps): AccessService` con `describe(): AccessReport` y `loginUrl(req, isLoopback: boolean): string | undefined`, donde `AccessReport = { mode: 'tailnet' | 'public' | 'loopback'; hostname?: string; declared: boolean; tokenUrlAvailable: boolean }`.

**Config nueva:** `publicHost: z.string().default('')` — el hostname por el que se alcanza el harness (por ejemplo `equipo.tailnet.ts.net`). Si está vacío, el modo es `loopback`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/access.spec.ts
import { describe, expect, it } from 'vitest'
import { createAccess } from '../src/access.ts'

const deps = (publicHost: string, port = 3080) => ({
  port,
  publicHost,
  authenticatedUrl: (url: string) => `${url}/?token=tok-123`,
  trustedHosts: publicHost === '' ? [] : [publicHost],
})

describe('createAccess', () => {
  it('en modo loopback no hay URL de login remota', () => {
    const access = createAccess(deps(''))
    expect(access.describe()).toMatchObject({ mode: 'loopback', declared: true })
    expect(access.loginUrl(true)).toContain('token=tok-123')
    expect(access.loginUrl(false)).toBeUndefined()
  })

  it('con publicHost declarado, el modo es tailnet y la URL usa ese host', () => {
    const access = createAccess(deps('equipo.tailnet.ts.net'))
    expect(access.describe()).toMatchObject({ mode: 'tailnet', hostname: 'equipo.tailnet.ts.net', declared: true })
    expect(access.loginUrl(true)).toBe('https://equipo.tailnet.ts.net/?token=tok-123')
  })

  it('avisa cuando el hostname público no está en trustedHosts', () => {
    const access = createAccess({ ...deps('equipo.tailnet.ts.net'), trustedHosts: [] })
    expect(access.describe().declared).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/access.spec.ts`
Expected: FAIL — cannot resolve `../src/access.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// src/access.ts
/** What the cockpit knows about how it is reached. */
export interface AccessReport {
  mode: 'tailnet' | 'public' | 'loopback'
  hostname?: string
  declared: boolean
}

/** Access diagnostics and the loopback-only login URL. */
export interface AccessService {
  describe(): AccessReport
  loginUrl(isLoopback: boolean): string | undefined
}

/**
 * Create the access service.
 * @param deps - listening port, configured public host, URL authenticator and declared authorities.
 * @returns the service.
 */
export function createAccess(deps: {
  port: number
  publicHost: string
  authenticatedUrl: (url: string) => string
  trustedHosts: readonly string[]
}): AccessService {
  const local = `http://127.0.0.1:${deps.port}`
  return {
    describe() {
      if (deps.publicHost === '') {
        return { mode: 'loopback', declared: true }
      }
      return {
        mode: deps.publicHost.endsWith('.ts.net') ? 'tailnet' : 'public',
        hostname: deps.publicHost,
        declared: deps.trustedHosts.includes(deps.publicHost),
      }
    },
    loginUrl(isLoopback) {
      if (!isLoopback) return undefined
      const base = deps.publicHost === '' ? local : `https://${deps.publicHost}`
      return deps.authenticatedUrl(base)
    },
  }
}
```

- [ ] **Step 4: Wire the routes**

En `src/gateway.ts`: añade `GET /api/access` que responde `{ ...access.describe(), tokenUrlAvailable: true, loginUrl: access.loginUrl(isLoopback(req)) }`, donde `isLoopback(req)` comprueba que `req.socket.remoteAddress` es `127.0.0.1`, `::1` o `::ffff:127.0.0.1` **y** que el `Host` es loopback. Añade `POST /api/security/revoke` que borra el registro `client-connection/browser-session` con `await ctx.credentials.delete('client-connection/browser-session')` *(verificar el método exacto de borrado en `packages/credentials/*/src/index.ts`)* y responde `{ ok: true, restartRequired: true }`.

- [ ] **Step 5: Run the tests and commit**

Run: `pnpm vitest run && pnpm run typecheck`
Expected: PASS.

```bash
git add src/access.ts src/config.ts src/gateway.ts tests/access.spec.ts
git commit -m "feat: report the access posture and mint the loopback login URL"
```

---

### Task 10: Página — esqueleto, cliente de API y navegación

**Files:**
- Create: `web/index.html`, `web/manifest.webmanifest`, `web/vite.config.ts`, `web/tsconfig.json`, `web/src/main.tsx`, `web/src/api.ts`, `web/src/App.tsx`, `web/src/styles.css`
- Modify: `package.json` (script `build:web`, y `build` pasa a `node build.mjs && pnpm run build:web`)
- Test: `web/src/api.test.ts`

**Depends on:** Task 7

**Interfaces:**
- Consumes: las rutas de Task 7 y Task 9.
- Produces: `createApi(fetchImpl?)` con `fleet()`, `attention()`, `decide(id, outcome)`, `start(workspace, prompt)`, `send(sessionId, text)`, `interrupt(sessionId)`, `access()`, `revoke()`, y `openStream(handler): () => void`; y `type View = 'board' | 'attention' | 'conversation' | 'new' | 'access'`.

**Decisiones de la página:** una sola página con estado de vista en memoria (sin router de URL), `lang="es"`, y todas las rutas de la API bajo `./api/` **relativas**, para que la base sirva igual bajo `/mission` que bajo un prefijo reescrito por un proxy.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/api.test.ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run web/src/api.test.ts`
Expected: FAIL — cannot resolve `./api.ts`.

- [ ] **Step 3: Write the API client**

```ts
// web/src/api.ts
import type { AttentionItem, Delta, FleetSnapshot } from '../../src/types.ts'

/** Answers one attention request and reports the access posture. */
export interface MissionApi {
  fleet(): Promise<FleetSnapshot>
  attention(): Promise<AttentionItem[]>
  decide(id: string, outcome: 'allow' | 'deny'): Promise<{ ok: boolean }>
  start(workspace: string, prompt: string): Promise<{ sessionId: string }>
  send(sessionId: string, text: string): Promise<{ accepted: true }>
  interrupt(sessionId: string): Promise<{ ok: true }>
  access(): Promise<{ loginUrl?: string; mode: string; hostname?: string; declared: boolean }>
  revoke(): Promise<{ ok: true; restartRequired: true }>
  openStream(onDelta: (delta: Delta) => void): () => void
}

/** Create the API client over fetch. */
export function createApi(fetchImpl: typeof fetch = fetch): MissionApi {
  const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetchImpl(path, {
      ...init,
      headers: init?.body === undefined ? {} : { 'content-type': 'application/json' },
    })
    if (!response.ok) throw new Error(String(response.status))
    return await response.json() as T
  }
  return {
    fleet: () => call<FleetSnapshot>('./api/fleet'),
    attention: () => call<AttentionItem[]>('./api/attention'),
    decide: (id, outcome) => call('./api/attention/' + encodeURIComponent(id) + '/decision', { method: 'POST', body: JSON.stringify({ outcome }) }),
    start: (workspace, prompt) => call('./api/sessions', { method: 'POST', body: JSON.stringify({ workspace, prompt }) }),
    send: (sessionId, text) => call('./api/sessions/' + encodeURIComponent(sessionId) + '/prompt', { method: 'POST', body: JSON.stringify({ text }) }),
    interrupt: (sessionId) => call('./api/sessions/' + encodeURIComponent(sessionId) + '/interrupt', { method: 'POST' }),
    access: () => call('./api/access'),
    revoke: () => call('./api/security/revoke', { method: 'POST' }),
    openStream(onDelta) {
      const source = new EventSource('./api/stream')
      source.onmessage = event => { onDelta(JSON.parse(event.data) as Delta) }
      return () => { source.close() }
    },
  }
}
```

- [ ] **Step 4: Write the shell and the manifest**

`web/index.html` monta `<div id="root">`, `lang="es"`, `viewport` con `viewport-fit=cover`, enlace al manifest y `<script type="module" src="/src/main.tsx">`. `web/manifest.webmanifest` declara `"name": "Misión — DSH"`, `"short_name": "Misión"`, `"display": "standalone"`, `"start_url": "./"` y `"scope": "./"`. `web/vite.config.ts` fija `base: './'`, `build.outDir: '../web-dist'`, `build.emptyOutDir: true` y el plugin de React. `web/src/App.tsx` mantiene `const [view, setView] = useState<View>('board')`, pide la flota al montar, abre el stream, y renderiza una barra inferior fija con las cuatro pestañas (Tablero, Atención, Nuevo, Acceso) y la vista activa. Cada vista se importa de `./views/`; hasta que existan, crea un componente `<p>Cargando…</p>` por vista.

- [ ] **Step 5: Run the tests, build the page and commit**

```bash
pnpm add -D vite @vitejs/plugin-react react react-dom @types/react @types/react-dom jsdom @testing-library/react
pnpm vitest run web/src/api.test.ts && pnpm run build:web && test -f web-dist/index.html
git add -A
git commit -m "feat(web): add the page shell, the API client and the tab navigation"
```

---

### Task 11: Página — tablero y atención

**Files:**
- Create: `web/src/views/Board.tsx`, `web/src/views/Attention.tsx`, `web/src/components/AgentRow.tsx`, `web/src/components/MetricStrip.tsx`, `web/src/components/AttentionCard.tsx`
- Modify: `web/src/App.tsx`
- Test: `web/src/views/Board.test.tsx`

**Depends on:** Task 10

**Interfaces:**
- Consumes: `FleetSnapshot`, `AgentCard`, `AttentionItem`, y `MissionApi`.
- Produces: `<Board fleet onOpen onDecide api />` y `<Attention items onDecide />`; `<AgentRow agent onOpen />` y `<AttentionCard item onDecide />`.

**Diseño aprobado:** contadores por estado arriba, banner de atención cuando hay algo pendiente que lleva a la pestaña, y filas indentadas con `padding-left: calc(var(--depth) * 14px)`, punto de estado, nombre, tok/s y porcentaje de contexto con barra. El orden lo decide el servidor: la página no reordena.

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/views/Board.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Board } from './Board.tsx'
import type { FleetSnapshot } from '../../../src/types.ts'

const fleet: FleetSnapshot = {
  asOf: 1,
  agents: [
    { sessionId: 's1', depth: 0, kind: 'root', title: 'Refactor pagos', workspace: '/w', state: 'running', model: 'deepseek-flash', metrics: { tokensPerSecond: 42, context: { used: 68, window: 100, percent: 68 }, lastActivityAt: 1 }, promptable: true },
    { sessionId: 's2', parentSessionId: 's1', depth: 1, kind: 'subagent', title: 'Migración BD', workspace: '/w', state: 'idle', metrics: { lastActivityAt: 1 }, promptable: false },
  ],
  attention: [{ id: 'a1', kind: 'approval', sessionId: 's1', since: 1, summary: 'npm test' }],
  workspaces: ['/w'],
  truncated: false,
  access: { mode: 'loopback', declared: true },
}

describe('Board', () => {
  it('muestra los contadores, el banner de atención y una fila por agente', () => {
    render(<Board fleet={fleet} onOpen={() => {}} onOpenAttention={() => {}} />)
    expect(screen.getByText('1')).toBeDefined()
    expect(screen.getByText(/aprobación esperando/i)).toBeDefined()
    expect(screen.getByText('Refactor pagos')).toBeDefined()
    expect(screen.getByText('Migración BD')).toBeDefined()
    expect(screen.getByText('42 tok/s')).toBeDefined()
  })

  it('indenta los subagentes por profundidad', () => {
    render(<Board fleet={fleet} onOpen={() => {}} onOpenAttention={() => {}} />)
    const row = screen.getByText('Migración BD').closest('[data-depth]')
    expect(row?.getAttribute('data-depth')).toBe('1')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run web/src/views/Board.test.tsx`
Expected: FAIL — cannot resolve `./Board.tsx`.

- [ ] **Step 3: Implement the components**

Reglas concretas: `MetricStrip` muestra `{tokensPerSecond} tok/s` solo si existe, el chip del modelo, y la barra de contexto con color `var(--ok)` por debajo del 70 %, `var(--warn)` entre 70 y 89, `var(--bad)` desde 90. `AgentRow` marca `data-depth={agent.depth}` y el punto de estado con la clase del estado (`idle`, `running`, `waiting`, `error`). `AttentionCard` pinta el resumen, el nombre del tool y dos botones, `Aprobar` y `Denegar`, que llaman a `onDecide(item.id, 'allow' | 'deny')`. `Attention` lista las tarjetas y muestra "Nada te espera" cuando está vacía. Si `fleet.truncated` es cierto, el tablero añade una línea "mostrando los primeros N agentes". **Estados obligatorios del spec:** sin agentes, el tablero muestra "Nada corriendo" y un botón que lleva a Nuevo; si el stream SSE falla o se cierra, una banda superior fija dice "Sin conexión, reintentando" y el tablero se pinta atenuado con `opacity: 0.6` hasta que se recupere; un agente en estado `error` lleva el punto en rojo y, en su fila, el motivo y un botón "Reintentar el turno" que llama a `onOpen`.

- [ ] **Step 4: Run the tests and commit**

Run: `pnpm vitest run && pnpm run build:web`
Expected: PASS y build correcto.

```bash
git add web/src/views web/src/components web/src/App.tsx
git commit -m "feat(web): render the fleet board and the attention inbox"
```

---


### Task 12: Conversación — stream del host y vista de burbujas

**Files:**
- Create: `src/conversation.ts`, `web/src/views/Conversation.tsx`, `web/src/components/Bubble.tsx`, `web/src/components/ToolRow.tsx`, `web/src/components/Composer.tsx`
- Modify: `src/gateway.ts` (implementar `GET /api/sessions/:id/stream`), `src/adapters/dsh.ts` (añadir `follow`), `web/src/api.ts` (`openConversation`), `web/src/App.tsx`
- Test: `tests/conversation.spec.ts`, `web/src/components/Bubble.test.tsx`

**Depends on:** Task 6, Task 7, Task 11

**Interfaces:**
- Consumes: `ctx.sessionController.follow(request, signal)` — `packages/api/session-controller/src/index.ts:479`, con `SessionFollowRequest = { address, maxMessages?, turnWindow?, assistantStream? }` (`types.ts:487-491`) y `SessionAddress` en *(verificar)* `packages/api/session-controller/src/types.ts`.
- Produces: `toEntries(frames: AsyncIterable<unknown>): AsyncIterable<TranscriptEntry>` y `createConversationStream(port, sessionId, signal): AsyncIterable<TranscriptEntry>`; en la página, `api.openConversation(sessionId, onEntry): () => void` y `<Conversation sessionId api onBack />`.

**Mapeo de frames a entradas** (los tipos de frame están en `types.ts:551-563`; los campos de cada registro hay que confirmarlos leyendo *(verificar)* `packages/api/session-controller/src/history.ts`):

| Frame | Entrada |
|---|---|
| `snapshot` | una entrada por cada `record` de `records[]`, en orden |
| `{ type: 'event' }` con `event.type === 'user/message'` | `kind: 'user'`, `text` del primer part de texto |
| `{ type: 'event' }` con `event.type === 'assistant/message'` | `kind: 'assistant'`, `text` concatenado de sus parts de texto |
| `{ type: 'event' }` con `event.type === 'tool/result'` | `kind: 'tool'`, `tool: { name, status: isError ? 'error' : 'ok', summary }` |
| `{ type: 'assistant-stream' }` con `frame.type === 'chunk'` | `kind: 'assistant'`, `streaming: true`, texto del chunk |
| `{ type: 'assistant-stream' }` con `frame.type === 'end'` | cierra la entrada en curso |
| cualquier otro | se ignora |

- [ ] **Step 1: Write the failing test**

```ts
// tests/conversation.spec.ts
import { describe, expect, it } from 'vitest'
import { toEntries } from '../src/conversation.ts'

async function* frames() {
  yield { type: 'snapshot', records: [
    { type: 'event', event: { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: 'arregla los reintentos' }] } } },
    { type: 'event', event: { seq: 2, type: 'assistant/message', data: { content: [{ type: 'text', text: 'Voy a moverlo antes del commit.' }] } } },
    { type: 'event', event: { seq: 3, type: 'tool/result', data: { toolName: 'edit', isError: false, content: [{ type: 'text', text: 'ok' }] } } },
  ] }
  yield { type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a', index: 0, time: 1, chunk: { type: 'text', text: 'Revisando' } } }
}

describe('toEntries', () => {
  it('convierte el snapshot y los frames vivos en entradas de transcripción', async () => {
    const entries = []
    for await (const entry of toEntries(frames() as never)) entries.push(entry)
    expect(entries.map(e => [e.kind, e.text ?? e.tool?.name])).toEqual([
      ['user', 'arregla los reintentos'],
      ['assistant', 'Voy a moverlo antes del commit.'],
      ['tool', 'edit'],
      ['assistant', 'Revisando'],
    ])
    expect(entries[2]?.tool).toMatchObject({ status: 'ok' })
    expect(entries[3]?.streaming).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/conversation.spec.ts`
Expected: FAIL — cannot resolve `../src/conversation.ts`.

- [ ] **Step 3: Write `src/conversation.ts`**

Implementa `toEntries` como un generador asíncrono que aplica la tabla de mapeo, con `at` tomado de `event.seq` cuando exista y de `Date.now()` cuando no, y `createConversationStream(port, sessionId, signal)` que abre `port.follow(sessionId, signal)` y devuelve `toEntries` sobre él. Añade `follow(sessionId, signal)` al puerto en `src/adapters/dsh.ts`, construyendo el `address` con la forma que confirmes en `types.ts` y pasando `assistantStream: true`.

- [ ] **Step 4: Implement the host route**

En `src/gateway.ts`, `GET /api/sessions/:id/stream` deja de responder 501: escribe la cabecera SSE, itera `createConversationStream` y manda cada entrada como `{ t: 'transcript.append', sessionId, entry }` con `event: transcript`, y cierra la iteración y la respuesta en `req.on('close')` pasando un `AbortController` como `signal`.

- [ ] **Step 5: Implement the view**

`<Conversation>` muestra un esqueleto de carga mientras no ha llegado la primera entrada, con el texto "Abriendo la conversación…" (una sesión fría tarda: no se pinta vacío). Después pinta arriba las migas (`‹ padre / este`) cuando el agente es un subagente, la tira de métricas con modelo, tok/s y barra de contexto, y debajo la lista de entradas. `Bubble` renderiza `kind: 'user'` alineado a la derecha con fondo de acento y `kind: 'assistant'` alineado a la izquierda; el texto se escapa siempre (nunca `innerHTML`), se respetan los saltos de línea con `white-space: pre-wrap`, y una entrada con `streaming: true` añade un cursor parpadeante. `ToolRow` muestra `▸ {name}` y `✓` o `✗` según el estado. `Composer` es un `textarea` de una línea creciente con botón de enviar y, mientras el agente corre, un botón de parar que llama a `onInterrupt`; deshabilita enviar con el texto vacío.

- [ ] **Step 6: Run the tests and commit**

```bash
pnpm vitest run && pnpm run typecheck && pnpm run build && pnpm run build:web
git add -A
git commit -m "feat: stream a conversation and render it as bubbles"
```

---

### Task 13: Página — nuevo y acceso

**Files:**
- Create: `web/src/views/New.tsx`, `web/src/views/Access.tsx`
- Modify: `web/src/App.tsx`
- Test: `web/src/views/Access.test.tsx`

**Depends on:** Task 9, Task 10

**Interfaces:**
- Consumes: `api.start`, `api.access`, `api.revoke`, y `fleet.workspaces`.
- Produces: `<New workspaces onStart />` y `<Access api />`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/views/Access.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Access } from './Access.tsx'

describe('Access', () => {
  it('muestra el modo, el hostname y avisa si no está declarado', async () => {
    const api = { access: async () => ({ mode: 'tailnet', hostname: 'equipo.tailnet.ts.net', declared: false, loginUrl: undefined }) }
    render(<Access api={api as never} />)
    expect(await screen.findByText(/tailnet/i)).toBeDefined()
    expect(await screen.findByText('equipo.tailnet.ts.net')).toBeDefined()
    expect(await screen.findByText(/no está en trustedHosts/i)).toBeDefined()
  })

  it('sin loginUrl explica que hay que abrirla desde el PC', async () => {
    const api = { access: async () => ({ mode: 'loopback', declared: true, loginUrl: undefined }) }
    render(<Access api={api as never} />)
    expect(await screen.findByText(/desde el propio PC/i)).toBeDefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run web/src/views/Access.test.tsx`
Expected: FAIL — cannot resolve `./Access.tsx`.

- [ ] **Step 3: Implement both views**

`Access` llama a `api.access()` al montar y muestra: el modo en palabras ("Red privada (Tailscale)", "Túnel público", "Solo local"), el hostname, un aviso en rojo si `declared === false` con el texto "no está en trustedHosts: añádelo con --trusted-host", el QR cuando hay `loginUrl` y un botón "Cerrar todas las sesiones de navegador" que llama a `api.revoke()` y muestra "hecho — reinicia dsh para que surta efecto". El QR se genera con la librería `qrcode` (`pnpm add qrcode`): `await QRCode.toDataURL(loginUrl)` y se pinta en un `<img width='220' height='220'>`. **No se escribe un codificador de QR a mano** y la vista no se queda sin QR: es la única forma de meter el token en el teléfono sin teclear una URL de 70 caracteres. `New` lista `workspaces` en un `select`, un `textarea` de primer prompt y un botón "Empezar" que llama a `onStart(workspace, prompt)`, deshabilitado con campos vacíos.

- [ ] **Step 4: Run the tests and commit**

```bash
pnpm vitest run && pnpm run build:web
git add -A
git commit -m "feat(web): add the new-session and access views with the login QR"
```

---

### Task 14: Instalación, README y smoke manual

**Files:**
- Create: `README.md`, `docs/smoke.md`
- Modify: `package.json` (versión final y `files`)

**Depends on:** todas

**Interfaces:**
- Consumes: el paquete construido (`lib/` y `web-dist/`).
- Produces: el procedimiento de instalación verificado y la lista de comprobación manual.

- [ ] **Step 1: Escribir el README**

En inglés, con estas secciones y sin huecos: **What it is** (una frase y una captura de la estructura de vistas), **Requirements** (Node ≥ 22.19, DSH 0.2.0-rc.2, Tailscale para acceso remoto), **Install** (`pnpm install && pnpm run build`, y luego cargar el plugin en el perfil `web`), **Develop** (`pnpm run check`), **Expose it safely** (Tailscale paso a paso: instalar en el PC y el teléfono, `tailscale up` en ambos, `tailscale serve` para publicar `127.0.0.1:3080` con certificado, y arrancar `dsh web --trusted-host <equipo>.<tailnet>.ts.net`; **verifica cada comando con `tailscale serve --help` de la versión instalada antes de escribirlo**), **Alternativa: Cloudflare Tunnel** (túnel nombrado con Access; hostname fijo, también en `--trusted-host`), **Security** (la cookie es un bearer de hasta 30 días sin logout; el cockpit no añade ni quita autenticación; revocar es borrar el registro y reiniciar), **Known limits** (la lista de §2.2 del spec), **Compatibility** (la versión de DSH contra la que se desarrolló y que los servicios internos pueden cambiar).

- [ ] **Step 2: Escribir el smoke manual**

En `docs/smoke.md`, una lista numerada y comprobable: 1) `dsh web` arranca y el plugin se monta sin errores; 2) `http://127.0.0.1:3080/mission/` pide login si no hay cookie; 3) con cookie, el tablero lista las sesiones reales con tok/s y contexto; 4) abrir una conversación muestra el historial y, al escribir, el turno arranca y las burbujas llegan en vivo; 5) lanzar desde "Nuevo" una sesión en un workspace y verla aparecer en el tablero; 6) provocar una aprobación (un comando de bash que requiera permiso) y aprobarla desde el teléfono; 7) desde el teléfono, con Tailscale, repetir 3 a 6; 8) cortar la red del teléfono y comprobar que al volver se recupera pidiendo snapshot nuevo; 9) reiniciar `dsh` y comprobar que la cookie sigue valiendo.

- [ ] **Step 3: Verificar la instalación de verdad y anotar el resultado**

Carga el plugin en el perfil `web` (con `dsh plugin --profile web add` sobre el tarball de `pnpm pack`, o con una fila en el patch del perfil apuntando a `file://` del `lib/index.js`), reinicia `dsh web` y recorre `docs/smoke.md`. **Anota en el README cualquier paso que haya diferido de lo escrito y corrige el README**, no el resultado.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: add install, exposure and smoke instructions"
```

---

## Verificación final

Antes de dar el plan por terminado, ejecutar desde la raíz del paquete:

```bash
pnpm run check && pnpm run build:web && test -f lib/index.js && test -f web-dist/index.html
```

Esperado: typecheck limpio, toda la suite en verde, y ambos artefactos presentes.

