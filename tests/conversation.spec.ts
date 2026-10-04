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
