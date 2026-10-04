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
