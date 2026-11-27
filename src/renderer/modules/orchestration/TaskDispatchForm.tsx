import { useRef, useState, type FormEvent } from 'react'
import type { AgentSession } from '../../../shared/ipc'

export type SendTask = (agent: AgentSession['agent']) => Promise<boolean>

export function TaskDispatchForm({ send }: { send: SendTask }) {
  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const inFlight = useRef(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    const value = new FormData(event.currentTarget).get('agent')
    if (value !== 'claude-code' && value !== 'codex') return
    inFlight.current = true
    setSending(true)
    try {
      if (await send(value)) setOpen(false)
    } finally {
      inFlight.current = false
      setSending(false)
    }
  }

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)}>
        Envoyer à un agent
      </button>
    )
  return (
    <form onSubmit={(event) => void submit(event)}>
      <label>
        Agent
        <select name="agent" autoFocus disabled={sending}>
          <option value="claude-code">Claude Code</option>
          <option value="codex">Codex</option>
        </select>
      </label>
      <button type="submit" disabled={sending}>
        {sending ? 'Envoi…' : 'Envoyer'}
      </button>
      <button type="button" disabled={sending} onClick={() => setOpen(false)}>
        Annuler l’envoi
      </button>
    </form>
  )
}
