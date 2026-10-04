import { useState, useEffect, useCallback, useRef } from 'react'
import type { MissionApi } from '../api.ts'
import type { TranscriptEntry } from '../../../src/types.ts'
import { Bubble } from '../components/Bubble.tsx'
import { ToolRow } from '../components/ToolRow.tsx'
import { Composer } from '../components/Composer.tsx'
import { MetricStrip } from '../components/MetricStrip.tsx'

interface ConversationProps {
  sessionId: string
  api: MissionApi
  onBack: () => void
}

export function Conversation({ sessionId, api, onBack }: ConversationProps) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [running, setRunning] = useState(false)
  const [agentInfo, setAgentInfo] = useState<{ model?: string; tokensPerSecond?: number; context?: { used: number; window: number; percent: number } } | null>(null)
  const [loading, setLoading] = useState(true)
  const [breadcrumb, setBreadcrumb] = useState<{ parent?: string; current: string }>({ current: sessionId.slice(0, 8) })
  const closeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const close = api.openConversation(sessionId, (entry: unknown) => {
      const e = entry as TranscriptEntry
      setLoading(false)
      setEntries(prev => {
        if (e.streaming && prev.length > 0) {
          const last = prev[prev.length - 1]
          if (last !== undefined && last.streaming) {
            const merged: TranscriptEntry = {
              ...last,
              text: (last.text ?? '') + (e.text ?? ''),
            }
            return [...prev.slice(0, -1), merged]
          }
        }
        return [...prev, e]
      })
    })
    closeRef.current = close

    api.fleet().then(f => {
      const agent = f.agents.find(a => a.sessionId === sessionId)
      if (agent) {
        setRunning(agent.state === 'running')
        setAgentInfo({
          ...(agent.model === undefined ? {} : { model: agent.model }),
          ...(agent.metrics.tokensPerSecond === undefined ? {} : { tokensPerSecond: agent.metrics.tokensPerSecond }),
          ...(agent.metrics.context === undefined ? {} : { context: agent.metrics.context }),
        })
        if (agent.parentSessionId) {
          const parent = f.agents.find(a => a.sessionId === agent.parentSessionId)
          setBreadcrumb({ parent: parent?.title ?? agent.parentSessionId.slice(0, 8), current: agent.title })
        } else {
          setBreadcrumb({ current: agent.title })
        }
      }
    }).catch(() => {})

    return () => {
      close()
    }
  }, [sessionId, api])

  const handleSend = useCallback(async (text: string) => {
    setRunning(true)
    await api.send(sessionId, text)
  }, [sessionId, api])

  const handleInterrupt = useCallback(async () => {
    await api.interrupt(sessionId)
    setRunning(false)
  }, [sessionId, api])

  const renderEntry = (entry: TranscriptEntry) => {
    if (entry.kind === 'tool') {
      return <ToolRow key={entry.seq} entry={entry} />
    }
    return <Bubble key={entry.seq} entry={entry} />
  }

  if (loading) {
    return (
      <div className="conversation conversation--loading">
        <p className="conversation-loading-text">Abriendo la conversación…</p>
      </div>
    )
  }

  return (
    <div className="conversation">
      <div className="conversation-header">
        <button className="conversation-back" onClick={onBack}>‹ {breadcrumb.parent ? breadcrumb.parent + ' / ' : ''}{breadcrumb.current}</button>
        {agentInfo && (
          <MetricStrip agent={{
            sessionId,
            depth: 0,
            kind: 'root',
            title: sessionId,
            workspace: '',
            state: running ? 'running' : 'idle',
            model: agentInfo.model,
            metrics: {
              tokensPerSecond: agentInfo.tokensPerSecond,
              context: agentInfo.context,
              lastActivityAt: Date.now(),
            },
            promptable: false,
          } as never} />
        )}
      </div>
      <div className="conversation-entries">
        {entries.map(renderEntry)}
      </div>
      <Composer onSend={handleSend} onInterrupt={handleInterrupt} running={running} />
    </div>
  )
}
