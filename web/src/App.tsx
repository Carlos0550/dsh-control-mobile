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
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [connected, setConnected] = useState(true)

  // Fetch fleet on mount
  useEffect(() => {
    api.fleet().then(f => {
      setFleet(f)
      setConnected(true)
    }).catch(() => setConnected(false))
  }, [])

  // Open SSE stream
  useEffect(() => {
    const close = api.openStream(
      (delta: Delta) => {
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
      },
      (status) => {
        setConnected(status === 'open')
      }
    )
    return close
  }, [])

  const handleOpen = (sid: string) => {
    setSessionId(sid)
    setView('conversation')
  }

  const handleOpenAttention = () => {
    setView('attention')
  }

  const handleDecide = async (id: string, outcome: 'allow' | 'deny') => {
    await api.decide(id, outcome)
    const items = await api.attention()
    setFleet(prev => prev ? { ...prev, attention: items } : prev)
  }

  const renderView = (): JSX.Element => {
    switch (view) {
      case 'board':
        if (!fleet) return <p>Cargando...</p>
        return <Board fleet={fleet} connected={connected} onOpen={handleOpen} onOpenAttention={handleOpenAttention} />
      case 'attention':
        if (!fleet) return <p>Cargando...</p>
        return <Attention items={fleet.attention} onDecide={handleDecide} />
      case 'conversation':
        return <Conversation />
      case 'new':
        return <New />
      case 'access':
        return <Access />
      default:
        return <p>Cargando...</p>
    }
  }

  return (
    <div className="app">
      <main className="view-area">
        {renderView()}
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
