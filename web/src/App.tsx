import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { createApi } from './api.ts'
import { Board } from './views/Board.tsx'
import { Attention } from './views/Attention.tsx'
import { Conversation } from './views/Conversation.tsx'
import { New } from './views/New.tsx'
import { Access } from './views/Access.tsx'
import type { FleetSnapshot, Delta } from '../../src/types.ts'

export type View = 'board' | 'attention' | 'conversation' | 'new' | 'access'

const api = createApi()

const viewComponents: Record<View, () => JSX.Element> = {
  board: Board,
  attention: Attention,
  conversation: Conversation,
  new: New,
  access: Access,
}

const TAB_LABELS: Record<View, string> = {
  board: 'Tablero',
  attention: 'Atención',
  conversation: 'Nuevo',
  new: 'Nuevo',
  access: 'Acceso',
}

export function App() {
  const [view, setView] = useState<View>('board')
  const [fleet, setFleet] = useState<FleetSnapshot | null>(null)

  // Fetch fleet on mount
  useEffect(() => {
    api.fleet().then(setFleet).catch(console.error)
  }, [])

  // Open SSE stream
  useEffect(() => {
    const close = api.openStream((delta: Delta) => {
      if (delta.t === 'agent.upsert') {
        setFleet(prev => {
          if (!prev) return prev
          const idx = prev.agents.findIndex(a => a.sessionId === delta.agent.sessionId)
          const agents = idx >= 0
            ? prev.agents.map((a, i) => i === idx ? delta.agent : a)
            : [...prev.agents, delta.agent]
          return { ...prev, agents }
        })
      } else if (delta.t === 'agent.remove') {
        setFleet(prev => prev ? { ...prev, agents: prev.agents.filter(a => a.sessionId !== delta.sessionId) } : prev)
      } else if (delta.t === 'attention.open' || delta.t === 'attention.close') {
        api.attention().then(items => setFleet(prev => prev ? { ...prev, attention: items } : prev)).catch(console.error)
      } else if (delta.t === 'access') {
        setFleet(prev => prev ? { ...prev, access: delta.access } : prev)
      }
    })
    return close
  }, [])

  const ActiveView = viewComponents[view]

  return (
    <div className="app">
      <main className="view-area">
        <ActiveView />
      </main>
      <nav className="tab-bar">
        {(['board', 'attention', 'new', 'access'] as View[]).map(tab => (
          <button
            key={tab}
            className={'tab ' + (view === tab ? 'tab--active' : '')}
            onClick={() => setView(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </nav>
    </div>
  )
}
