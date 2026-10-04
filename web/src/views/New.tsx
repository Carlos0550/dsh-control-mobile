import { useState } from 'react'

interface Props {
  workspaces: string[]
  onStart: (workspace: string, prompt: string) => void
}

export function New({ workspaces, onStart }: Props) {
  const [workspace, setWorkspace] = useState('')
  const [prompt, setPrompt] = useState('')

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (workspace && prompt.trim()) {
      onStart(workspace, prompt)
    }
  }

  return (
    <div className="new-view">
      <h2>Nueva sesión</h2>
      <form onSubmit={handleSubmit}>
        <label>
          Workspace
          <select
            name="workspace"
            value={workspace}
            onChange={e => setWorkspace(e.target.value)}
            required
          >
            <option value="">Selecciona un workspace...</option>
            {workspaces.map(ws => (
              <option key={ws} value={ws}>{ws}</option>
            ))}
          </select>
        </label>
        <label>
          Primer prompt
          <textarea
            name="prompt"
            rows={4}
            placeholder="¿Qué quieres que haga el agente?"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={!workspace || !prompt.trim()}>
          Empezar
        </button>
      </form>
    </div>
  )
}
