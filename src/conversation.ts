import type { DshPort } from './adapters/dsh.ts'
import type { TranscriptEntry } from './types.ts'

// ---------------------------------------------------------------------------
// Types for session-controller frames
// ---------------------------------------------------------------------------

interface SnapshotFrame {
  type: 'snapshot'
  records: readonly { type: 'event'; event: SessionEvent }[]
}

interface AssistantStreamFrame {
  type: 'assistant-stream'
  frame: {
    type: 'chunk'
    chunk: { type: 'text'; text: string }
  } | {
    type: 'end'
  }
}

type FollowFrame = SnapshotFrame | AssistantStreamFrame

interface SessionEvent {
  type: string
  seq: number
  time?: number
  data: unknown
}

interface SessionFollowRequest {
  address: { kind: 'session'; sessionId: string }
  assistantStream?: true
}

// ---------------------------------------------------------------------------
// toEntries
// ---------------------------------------------------------------------------

/**
 * Maps session-controller FollowFrame async iterable to TranscriptEntry async iterable.
 * - snapshot records: one entry per record in order
 * - user/message: kind='user', text from first text part
 * - assistant/message: kind='assistant', text concatenated from text parts
 * - tool/result: kind='tool', tool={ name, status, summary }
 * - assistant-stream chunk: kind='assistant', streaming=true, text from chunk
 * - assistant-stream end: close in-progress streamed entry (no new entry)
 */
export async function* toEntries(
  frames: AsyncIterable<unknown>,
): AsyncIterable<TranscriptEntry> {
  let seqCounter = 0

  for await (const raw of frames) { const frame = raw as FollowFrame;
    // snapshot: emit one entry per record
    if (frame.type === 'snapshot') {
      for (const record of frame.records) {
        if (record.type !== 'event') continue
        const event = record.event
        const entry = mapEventToEntry(event)
        if (entry) {
          seqCounter++
          yield entry
        }
      }
      continue
    }

    // assistant-stream
    if (frame.type === 'assistant-stream') {
      const f = frame.frame
      if (f.type === 'chunk') {
        // streaming assistant entry
        yield {
          seq: seqCounter++,
          kind: 'assistant',
          text: f.chunk.text,
          at: Date.now(),
          streaming: true,
        }
      }
      // f.type === 'end' → close (nothing to emit)
    }
  }
}

function mapEventToEntry(event: SessionEvent): TranscriptEntry | null {
  const seq = event.seq
  const at = (event as { time?: number }).time ?? Date.now()

  if (event.type === 'user/message') {
    const data = event.data as { content: { type: 'text'; text: string }[] }
    const first = data.content.find(c => c.type === 'text')
    if (!first) return null
    return { seq, kind: 'user', text: first.text, at }
  }

  if (event.type === 'assistant/message') {
    const data = event.data as { content: { type: 'text'; text: string }[] }
    const texts = data.content.filter(c => c.type === 'text').map(c => c.text)
    const text = texts.join('')
    return { seq, kind: 'assistant', text, at }
  }

  if (event.type === 'tool/result') {
    const data = event.data as { toolName: string; isError: boolean; content: { type: 'text'; text: string }[] }
    const summary = data.content.find(c => c.type === 'text')?.text ?? ''
    return {
      seq,
      kind: 'tool',
      tool: { name: data.toolName, status: data.isError ? 'error' : 'ok', summary },
      at,
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// createConversationStream
// ---------------------------------------------------------------------------

/**
 * Opens a conversation stream for the given session using port.follow.
 */
export async function* createConversationStream(
  port: DshPort,
  sessionId: string,
  signal: AbortSignal,
): AsyncIterable<TranscriptEntry> {
  const follower = port.follow(sessionId, signal)
  yield* toEntries(follower)
}
