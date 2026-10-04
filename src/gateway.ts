import { existsSync, readFileSync } from 'node:fs'
import type { AttentionService } from './attention.ts'
import type { DeltaHub } from './live.ts'
import type { DshPort } from './adapters/dsh.ts'
import type { Actions } from './actions.ts'
import type { AccessService } from './access.ts'
import type { FleetSnapshot, Delta } from './types.ts'
import { join, extname } from 'path'

// ---------------------------------------------------------------------------
// Local types (mirroring DSH module augmentations without importing them)
// ---------------------------------------------------------------------------

interface WebServer {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: HttpRequest, res: HttpResponse) => void | Promise<void>
  }): () => void
  port: number
}

interface Connection {
  admit(request: unknown): { peer: unknown } | { rejection: number }
  authenticatedUrl(baseUrl: string): string
  requestRejection(request: unknown): number | undefined
}

interface GatewayContext {
  webServer: WebServer
  connection: Connection
  on(event: string, handler: (...args: unknown[]) => void): () => void
}

interface HttpRequest {
  method?: string
  url?: string
  headers?: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string }
  on(event: string, listener: (...args: any[]) => void): void
  removeListener(event: string, listener: (...args: any[]) => void): void
}

interface HttpResponse {
  writeHead(status: number, headers?: Record<string, string>): HttpResponse
  end(body?: string | Buffer): void
  write(chunk: string): boolean
  setHeader(name: string, value: string): void
  on(event: 'close', listener: () => void): void
  removeListener(event: 'close', listener: () => void): void
}

interface RouteDeps {
  ctx: GatewayContext
  config: { path: string; fleetLimit: number; hotWindowMs: number; publicHost: string }
  port: DshPort
  actions: Actions
  attention: AttentionService
  hub: DeltaHub
  snapshot(): Promise<FleetSnapshot>
  root: string
  access: AccessService
}

// ---------------------------------------------------------------------------
// Admission
// ---------------------------------------------------------------------------

function admit(ctx: GatewayContext, req: HttpRequest, res: HttpResponse): boolean {
  const result = ctx.connection.admit(req)
  if ('rejection' in result) {
    const status = typeof result.rejection === 'number' ? result.rejection : 403
    res.writeHead(status)
    res.end()
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

function sendJson(res: HttpResponse, status: number, value: unknown): void {
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.writeHead(status)
  res.end(JSON.stringify(value))
}

async function readJson(req: HttpRequest, limit = 64 * 1024): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const onClose = (): void => { reject(new Error('connection closed')) }
    const onData = (chunk: Buffer): void => {
      size += chunk.length
      if (size > limit) { reject(new Error('body too large')); return }
      chunks.push(chunk)
    }
    const onEnd = (): void => {
      req.removeListener('close', onClose)
      req.removeListener('data', onData)
      req.removeListener('end', onEnd)
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(JSON.parse(text))
      } catch {
        reject(new Error('invalid JSON'))
      }
    }
    req.on('close', onClose)
    req.on('data', onData)
    req.on('end', onEnd)
  })
}

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------

const mimeTypes: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.json': 'application/json',
  '.txt': 'text/plain',
}

function mimeFor(path: string): string {
  const ext = extname(path).toLowerCase()
  return mimeTypes[ext] ?? 'application/octet-stream'
}

// ---------------------------------------------------------------------------
// Static file serving (synchronous - uses top-level fs import)
// ---------------------------------------------------------------------------

function serveStatic(res: HttpResponse, filePath: string, root: string): void {
  // Security: reject paths that escape the root directory
  const normalized = filePath.replace(/\\/g, '/')
  if (normalized.includes('..') || !normalized.startsWith('/')) {
    res.writeHead(403)
    res.end()
    return
  }

  if (!existsSync(filePath)) {
    res.writeHead(404)
    res.end()
    return
  }

  const content = readFileSync(filePath)
  const mime = mimeFor(filePath)
  res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-cache' })
  res.end(content)
}

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------

function writeEventStream(res: HttpResponse, deps: RouteDeps): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no',
  })

  const unsubscribe = deps.hub.subscribe((delta: Delta) => {
    res.write(`data: ${JSON.stringify(delta)}\n\n`)
  })

  const heartbeat = setInterval(() => {
    res.write(`data: ${JSON.stringify({ t: 'heartbeat', at: Date.now() })}\n\n`)
  }, 20_000)

  const onClose = (): void => {
    unsubscribe()
    clearInterval(heartbeat)
  }

  res.on('close', onClose)
}

// ---------------------------------------------------------------------------
// Loopback detection
// ---------------------------------------------------------------------------

function isLoopback(req: HttpRequest): boolean {
  const addr = req.socket?.remoteAddress
  const isAddrLoopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
  if (!isAddrLoopback) return false
  // Check Host header is also loopback
  const hostHeader = req.headers?.host
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader
  if (host === undefined) return false
  const [hostName] = host.split(':')
  const hostLoopback = hostName === 'localhost' || hostName === '127.0.0.1' || hostName === '[::1]'
  return hostLoopback
}

// ---------------------------------------------------------------------------
// API dispatcher
// ---------------------------------------------------------------------------

async function handleApi(req: HttpRequest, res: HttpResponse, deps: RouteDeps): Promise<void> {
  // Parse URL - get the path without query string
  const [pathPart] = (req.url ?? '').split('?')
  const pathname = pathPart ?? ''

  // Strip base path (/mission/api) to get API-relative path
  const basePath = `${deps.config.path}/api`
  const apiPath = pathname.startsWith(basePath)
    ? pathname.slice(basePath.length)
    : pathname

  // Route matching helper
  const match = (pattern: string): Record<string, string> | null => {
    const patternParts = pattern.split('/').filter(Boolean)
    const pathParts = apiPath.split('/').filter(Boolean)
    if (patternParts.length !== pathParts.length) return null
    const params: Record<string, string> = {}
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i]!.startsWith(':')) {
        params[patternParts[i]!.slice(1)] = pathParts[i] ?? ''
      } else if (patternParts[i] !== pathParts[i]) {
        return null
      }
    }
    return params
  }

  const method = req.method ?? 'GET'

  // GET /api/access
  if (method === 'GET' && apiPath === '/access') {
    const report = deps.access.describe()
    sendJson(res, 200, {
      ...report,
      tokenUrlAvailable: true,
      loginUrl: deps.access.loginUrl(isLoopback(req)),
    })
    return
  }

  // POST /api/security/revoke
  if (method === 'POST' && apiPath === '/security/revoke') {
    await deps.port.revokeBrowserSessions()
    sendJson(res, 200, { ok: true, restartRequired: true })
    return
  }

  // GET /api/fleet
  if (method === 'GET' && apiPath === '/fleet') {
    const snapshot = await deps.snapshot()
    sendJson(res, 200, snapshot)
    return
  }

  // GET /api/attention
  if (method === 'GET' && apiPath === '/attention') {
    sendJson(res, 200, deps.attention.list())
    return
  }

  // POST /api/attention/:id/decision
  if (method === 'POST') {
    const decisionMatch = match('/attention/:id/decision')
    if (decisionMatch) {
      const itemId = decisionMatch['id']
      if (itemId === undefined) {
        sendJson(res, 404, { error: 'attention item not found' })
        return
      }
      try {
        const body = await readJson(req) as { outcome: 'allow' | 'deny' }
        const ok = deps.attention.decide(itemId, body.outcome)
        if (!ok) {
          sendJson(res, 404, { error: 'attention item not found' })
          return
        }
        sendJson(res, 200, { ok: true })
        return
      } catch {
        sendJson(res, 400, { error: 'invalid request body' })
        return
      }
    }

    // POST /api/sessions
    if (apiPath === '/sessions') {
      try {
        const body = await readJson(req) as { workspace: string; prompt: string }
        if (typeof body.workspace !== 'string' || typeof body.prompt !== 'string') {
          sendJson(res, 400, { error: 'invalid request body' })
          return
        }
        const sessionId = await deps.actions.start(body.workspace, body.prompt)
        if (sessionId === undefined) {
          sendJson(res, 502, { error: 'session creation failed' })
          return
        }
        sendJson(res, 200, { sessionId })
        return
      } catch {
        sendJson(res, 400, { error: 'invalid request body' })
        return
      }
    }

    // POST /api/sessions/:id/prompt
    const promptMatch = match('/sessions/:id/prompt')
    if (promptMatch) {
      const sessionId = promptMatch['id']
      if (sessionId === undefined) {
        sendJson(res, 400, { error: 'invalid request body' })
        return
      }
      try {
        const body = await readJson(req) as { text: string }
        if (typeof body.text !== 'string') {
          sendJson(res, 400, { error: 'invalid request body' })
          return
        }
        await deps.actions.send(sessionId, body.text)
        sendJson(res, 200, { accepted: true })
        return
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        sendJson(res, msg === 'empty prompt' ? 400 : 502, { error: msg || 'request failed' })
        return
      }
    }

    // POST /api/sessions/:id/interrupt
    const interruptMatch = match('/sessions/:id/interrupt')
    if (interruptMatch) {
      const id = interruptMatch['id']
      if (id !== undefined) {
        await deps.actions.interrupt(id)
      }
      sendJson(res, 200, { ok: true })
      return
    }
  }

  // GET /api/stream (SSE)
  if (method === 'GET' && apiPath === '/stream') {
    writeEventStream(res, deps)
    return
  }

  // GET /api/sessions/:id/stream (not implemented)
  const streamMatch = match('/sessions/:id/stream')
  if (streamMatch) {
    sendJson(res, 501, { error: 'conversation stream not implemented' })
    return
  }

  // 404 for unknown API routes
  sendJson(res, 404, { error: 'not found' })
}

// ---------------------------------------------------------------------------
// Gateway mount
// ---------------------------------------------------------------------------

export function mountGateway(deps: RouteDeps): () => void {
  const cleanups: (() => void)[] = []

  // R6: Page index (exact) and assets (prefix) served WITHOUT admit
  // Exact index route
  cleanups.push(deps.ctx.webServer.register({
    kind: 'exact',
    path: deps.config.path,
    handler(_req: HttpRequest, res: HttpResponse) {
      const indexPath = join(deps.root, 'web-dist', 'index.html')
      serveStatic(res, indexPath, join(deps.root, 'web-dist'))
    },
  }))

  // Static assets route (prefix, no admit)
  cleanups.push(deps.ctx.webServer.register({
    kind: 'prefix',
    path: `${deps.config.path}/assets`,
    handler(req: HttpRequest, res: HttpResponse) {
      const [pathPart] = (req.url ?? '').split('?')
      const pathname = pathPart ?? ''
      const filePath = pathname.replace(`${deps.config.path}/assets`, '') || '/'
      const staticPath = join(deps.root, 'web-dist', filePath)
      serveStatic(res, staticPath, join(deps.root, 'web-dist'))
    },
  }))

  // API routes (prefix, WITH admit per R6)
  cleanups.push(deps.ctx.webServer.register({
    kind: 'prefix',
    path: `${deps.config.path}/api`,
    handler(req: HttpRequest, res: HttpResponse) {
      if (!admit(deps.ctx, req, res)) return
      void handleApi(req, res, deps)
    },
  }))

  // Return cleanup function
  return () => { cleanups.forEach(fn => fn()) }
}
