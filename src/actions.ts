import type { DshPort } from './adapters/dsh.ts'

/** The three control actions the cockpit offers. */
export interface Actions {
  start(workspace: string, prompt: string): Promise<string | undefined>
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
