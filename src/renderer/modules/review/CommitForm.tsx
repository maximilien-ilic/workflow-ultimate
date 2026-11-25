import { useState } from 'react'

type Props = {
  projectId: string
  worktreePath: string
  checkedPaths: string[]
  allChecked: boolean
  onCommitted: () => void
}

// Commit des fichiers cochés (tous si tout est coché), puis push à la demande. Les erreurs de git
// s'affichent telles quelles : c'est le message le plus utile pour comprendre ce qui bloque.
export function CommitForm({ projectId, worktreePath, checkedPaths, allChecked, onCommitted }: Props) {
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState('')
  const worktree = { projectId, worktreePath }

  const commit = async () => {
    const paths = allChecked ? undefined : checkedPaths
    const { sha } = await window.wu.invoke('review:commit', { ...worktree, message, paths })
    setMessage('')
    setStatus(`Commit ${sha.slice(0, 7)} créé.`)
    onCommitted()
  }
  const push = async () => {
    const { output } = await window.wu.invoke('review:push', worktree)
    setStatus(output || 'Branche poussée.')
  }
  const run = (action: () => Promise<void>) => action().catch((e: unknown) => setStatus(String(e)))

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
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="feat(module): ce qui change"
      />
      <button type="submit" disabled={!message.trim() || checkedPaths.length === 0}>
        Commiter
      </button>
      <button type="button" onClick={() => void run(push)}>
        Pousser
      </button>
      {status && <p role="status">{status}</p>}
    </form>
  )
}
