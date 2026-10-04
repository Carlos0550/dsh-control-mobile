import { useState, useRef, useCallback } from 'react'

interface ComposerProps {
  onSend: (text: string) => void
  onInterrupt: () => void
  running: boolean
}

export function Composer({ onSend, onInterrupt, running }: ComposerProps) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSend(trimmed)
    setText('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [text, onSend])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    // Auto-grow
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
    }
  }

  return (
    <div className="composer">
      <textarea
        ref={textareaRef}
        className="composer-input"
        value={text}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder="Escribe un mensaje…"
        rows={1}
        disabled={running}
      />
      {running ? (
        <button className="composer-btn composer-btn--stop" onClick={onInterrupt} title="Parar">
          ⏹
        </button>
      ) : (
        <button className="composer-btn composer-btn--send" onClick={handleSend} disabled={!text.trim()} title="Enviar">
          →
        </button>
      )}
    </div>
  )
}
