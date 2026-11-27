import { useCallback, useEffect, useImperativeHandle, useState, useSyncExternalStore, type FormEvent, type Ref } from 'react'
import type { ReviewComment, ReviewCommentSide } from '../../../shared/ipc'
import { agentStore } from '../agents/agent-store'
import { paneIds } from '../terminals/pane-tree'
import { terminalStore } from '../terminals/terminal-store'

export type CommentAnchor = { line: number; maxLine: number; side: ReviewCommentSide }
export type ReviewCommentEditor = { selectLine(path: string, anchor: CommentAnchor): void }
type Props = {
  projectId: string; worktreePath: string; filePath?: string; anchor?: CommentAnchor
  ref?: Ref<ReviewCommentEditor>
}
type Draft = Omit<CommentAnchor, 'line'> & { line: string; body: string }
const sideLabel = { before: 'Avant', after: 'Après' }
const anchorToDraft = (anchor: CommentAnchor): Draft => ({ ...anchor, line: String(anchor.line), body: '' })

export function ReviewComments({ projectId, worktreePath, filePath, anchor, ref }: Props) {
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
  const draft = filePath && anchor ? drafts.get(filePath) ?? anchorToDraft(anchor) : undefined
  const editDraft = useCallback((path: string, fallback: Draft, changes: Partial<Draft>) => {
    setDrafts((previous) => new Map(previous).set(path, { ...(previous.get(path) ?? fallback), ...changes }))
  }, [])
  useImperativeHandle(ref, () => ({
    selectLine: (path, selection) => {
      const next = anchorToDraft(selection)
      editDraft(path, next, { line: next.line, side: next.side, maxLine: next.maxLine })
    },
  }), [editDraft])

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
    if (!filePath || !draft) return
    void run(async () => {
      const result = await window.wu.invoke('review:addComment', {
        projectId, worktreePath, path: filePath,
        line: Number(draft.line), side: draft.side, body: draft.body,
      })
      setDrafts((previous) => {
        const next = new Map(previous)
        next.delete(filePath)
        return next
      })
      return result
    })
  }

  return (
    <section className="review-comments" aria-label="Commentaires de revue">
      <h3>Commentaires de revue</h3>
      {filePath && draft && (
        <form key={filePath} onSubmit={add}>
          <span id="review-comment-side">{sideLabel[draft.side]}</span>
          <label>
            Ligne <input name="line" type="number" min={1} max={draft.maxLine} required disabled={busy}
              aria-describedby="review-comment-side"
              value={draft.line} onChange={(event) => editDraft(filePath, draft, { line: event.target.value })} />
          </label>
          <label>
            Commentaire <textarea name="body" maxLength={4000} required disabled={busy}
              value={draft.body} onChange={(event) => editDraft(filePath, draft, { body: event.target.value })} />
          </label>
          <button disabled={busy || !comments}>Ajouter le commentaire</button>
        </form>
      )}
      {comments && comments.length > 0 && (
        <ul>
          {comments.map((comment) => (
            <li key={comment.id}>
              {comment.path}:{comment.line} ({comment.side ? sideLabel[comment.side].toLowerCase() : 'côté indéterminé'}) — {comment.body} · <span>{comment.sentAt ? 'Envoyé' : 'À envoyer'}</span>
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
