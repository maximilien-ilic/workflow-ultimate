import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react'
import type { ReviewComment } from '../../../shared/ipc'
import { agentStore } from '../agents/agent-store'
import { paneIds } from '../terminals/pane-tree'
import { terminalStore } from '../terminals/terminal-store'

type Props = { projectId: string; worktreePath: string; filePath?: string; line: number; maxLine?: number }
type Draft = { line: string; body: string }

export function ReviewComments({ projectId, worktreePath, filePath, line, maxLine }: Props) {
  const [comments, setComments] = useState<ReviewComment[] | null>(null)
  const [drafts, setDrafts] = useState(() => new Map<string, Draft>())
  const [selectedAgent, setSelectedAgent] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { tabs } = useSyncExternalStore(terminalStore.subscribe, terminalStore.get)
  useSyncExternalStore(agentStore.subscribe, agentStore.version)
  const agents = tabs.filter((tab) => tab.cwd === worktreePath).flatMap(({ tree }) =>
    paneIds(tree).flatMap((id) => {
      const agent = agentStore.get(id)
      return agent && !agent.exited && agent.state === 'done' ? [agent] : []
    }),
  )
  const recipient = agents.find(({ sessionId }) => sessionId === selectedAgent) ?? agents[0]
  const hasPending = comments?.some(({ sentAt }) => sentAt === null)
  const draft = (filePath && drafts.get(filePath)) || { line: String(line), body: '' }

  useEffect(() => {
    let active = true
    void window.wu.invoke('review:comments', { projectId, worktreePath }).then(
      (result) => { if (active) setComments(result) },
      (cause: unknown) => { if (active) setError(String(cause)) },
    )
    return () => { active = false }
  }, [projectId, worktreePath])

  async function run(action: () => Promise<ReviewComment[]>) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      setComments(await action())
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!filePath) return
    void run(async () => {
      const result = await window.wu.invoke('review:addComment', {
        projectId, worktreePath, path: filePath,
        line: Number(draft.line), body: draft.body,
      })
      setDrafts((previous) => {
        const next = new Map(previous)
        next.delete(filePath)
        return next
      })
      return result
    })
  }

  function editDraft(changes: Partial<Draft>) {
    if (!filePath) return
    setDrafts((previous) => new Map(previous).set(filePath, { ...draft, ...changes }))
  }

  return (
    <section className="review-comments" aria-label="Commentaires de revue">
      <h3>Commentaires de revue</h3>
      {filePath && maxLine !== undefined && (
        <form key={filePath} onSubmit={add}>
          <label>
            Ligne <input name="line" type="number" min={1} max={maxLine} required disabled={busy}
              value={draft.line} onChange={(event) => editDraft({ line: event.target.value })} />
          </label>
          <label>
            Commentaire <textarea name="body" maxLength={4000} required disabled={busy}
              value={draft.body} onChange={(event) => editDraft({ body: event.target.value })} />
          </label>
          <button disabled={busy || !comments}>Ajouter le commentaire</button>
        </form>
      )}
      {comments && comments.length > 0 && (
        <ul>
          {comments.map((comment) => (
            <li key={comment.id}>
              {comment.path}:{comment.line} — {comment.body} · <span>{comment.sentAt ? 'Envoyé' : 'À envoyer'}</span>
            </li>
          ))}
        </ul>
      )}
      {hasPending && (
        <>
          {agents.length > 1 && (
            <label>Agent <select value={recipient?.sessionId} onChange={(event) => setSelectedAgent(event.target.value)}>
              {agents.map(({ sessionId, title }) => <option key={sessionId} value={sessionId}>{title}</option>)}
            </select></label>
          )}
          <button type="button" disabled={busy || !recipient} onClick={() => {
            if (recipient) void run(() => window.wu.invoke('review:sendComments', {
              projectId, worktreePath, sessionId: recipient.sessionId,
            }))
          }}>Envoyer à l’agent</button>
          {!recipient && <p>Aucun agent disponible dans ce worktree.</p>}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
