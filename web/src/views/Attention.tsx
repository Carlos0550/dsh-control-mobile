import type { AttentionItem } from '../../../src/types.ts'
import { AttentionCard } from '../components/AttentionCard.tsx'

interface AttentionProps {
  items: AttentionItem[]
  onDecide: (id: string, outcome: 'allow' | 'deny') => void
}

export function Attention({ items, onDecide }: AttentionProps) {
  if (items.length === 0) {
    return (
      <div className="attention attention--empty">
        <p className="attention-empty-msg">Nada te espera</p>
      </div>
    )
  }

  return (
    <div className="attention">
      {items.map(item => (
        <AttentionCard key={item.id} item={item} onDecide={onDecide} />
      ))}
    </div>
  )
}
