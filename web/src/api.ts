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
  openStream(onDelta: (delta: Delta) => void, onStatus?: (status: 'open' | 'closed') => void): () => void
  openConversation(sessionId: string, onEntry: (entry: unknown) => void): () => void
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
    openConversation(sessionId, onEntry) {
      const source = new EventSource('./api/sessions/' + encodeURIComponent(sessionId) + '/stream')
      source.addEventListener('transcript', (e: MessageEvent) => {
        const data = JSON.parse(e.data) as { entry: unknown }
        onEntry(data.entry)
      })
      return () => { source.close() }
    },
    openStream(onDelta, onStatus) {
      const source = new EventSource('./api/stream')
      source.onmessage = event => { onDelta(JSON.parse(event.data) as Delta) }
      source.onopen = () => onStatus?.('open')
      source.onerror = () => onStatus?.('closed')
      return () => { source.close() }
    },
  }
}
