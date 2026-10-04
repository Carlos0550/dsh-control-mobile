import type { TranscriptEntry } from '../../../src/types.ts'

interface ToolRowProps {
  entry: TranscriptEntry
}

export function ToolRow({ entry }: ToolRowProps) {
  if (entry.kind !== 'tool' || !entry.tool) return null

  const { name, status } = entry.tool
  const icon = status === 'error' ? '✗' : '✓'

  return (
    <div className={`tool-row tool-row--${status}`}>
      <span className="tool-row-icon">▸ {name}</span>
      <span className="tool-row-status">{icon}</span>
    </div>
  )
}
