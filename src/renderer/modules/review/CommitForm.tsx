import { useState } from 'react'

type Props = {
  projectId: string
  worktreePath: string
  checkedPaths: string[]
  onCommitted: () => Promise<void>
  onSuggestMessage: () => Promise<void>
}

// Commit des fichiers de la sélection affichée, puis push à la demande.
export function CommitForm({ projectId, worktreePath, checkedPaths, onCommitted, onSuggestMessage }: Props) {
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState('')
  const [pending, setPending] = useState(false)
  const worktree = { projectId, worktreePath }

  const commit = async () => {
    const { sha } = await window.wu.invoke('review:commit', { ...worktree, message, paths: checkedPaths })
    setMessage('')
    setStatus(`Commit ${sha.slice(0, 7)} créé.`)
    await onCommitted()
  }
  const push = async () => {
    const { output } = await window.wu.invoke('review:push', worktree)
    setStatus(output || 'Branche poussée.')
  }
  const run = async (action: () => Promise<void>) => {
    if (pending) return
    setPending(true)
    try {
      await action()
    } catch (error) {
      setStatus(String(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      className="commit-form"
      aria-label="Commit"
      onSubmit={(e) => {
        e.preventDefault()
        void run(commit)
      }}
    >
      <textarea
        aria-label="Message de commit"
        disabled={pending}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="feat(module): ce qui change"
      />
      <button type="submit" disabled={pending || !message.trim() || checkedPaths.length === 0}>
        Commiter
      </button>
      <button type="button" disabled={pending || checkedPaths.length === 0} onClick={() => void run(onSuggestMessage)}>
        Demander un message à un agent
      </button>
      <button type="button" disabled={pending} onClick={() => void run(push)}>
        Pousser
      </button>
      {status && <p role="status">{status}</p>}
    </form>
  )
}
