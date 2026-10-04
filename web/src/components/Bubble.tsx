import type { TranscriptEntry } from '../../../src/types.ts'

interface BubbleProps {
  entry: TranscriptEntry
}

export function Bubble({ entry }: BubbleProps) {
  if (entry.kind === 'tool') {
    return null // ToolRow handles this
  }

  const text = entry.text ?? ''
  const baseClass = entry.kind === 'user' ? 'bubble--user' : 'bubble--assistant'
  const streamingClass = entry.streaming ? ' bubble--streaming' : ''

  return (
    <div className={`bubble ${baseClass}${streamingClass}`}>
      <span className="bubble-text" style={{ whiteSpace: 'pre-wrap' }}>{text}</span>
      {entry.streaming && <span className="bubble-cursor">▋</span>}
    </div>
  )
}
