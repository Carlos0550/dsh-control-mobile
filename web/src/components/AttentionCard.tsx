import type { AttentionItem } from '../../../src/types.ts'

interface AttentionCardProps {
  item: AttentionItem
  onDecide: (id: string, outcome: 'allow' | 'deny') => void
}

export function AttentionCard({ item, onDecide }: AttentionCardProps) {
  return (
    <div className="attention-card">
      <div className="attention-card-header">
        <span className="attention-card-kind">{item.kind}</span>
        {item.detail?.toolName && (
          <span className="attention-card-tool">{item.detail.toolName}</span>
        )}
      </div>
      <p className="attention-card-summary">{item.summary}</p>
      <div className="attention-card-actions">
        <button
          className="btn-approve"
          onClick={() => onDecide(item.id, 'allow')}
        >
          Aprobar
        </button>
        <button
          className="btn-deny"
          onClick={() => onDecide(item.id, 'deny')}
        >
          Denegar
        </button>
      </div>
    </div>
  )
}
