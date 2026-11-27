import { useCallback, useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import type { PullRequestCheck, PullRequestContext } from '../../../shared/ipc'
import './pull-request.css'

const REFRESH_INTERVAL_MS = 30_000
const checkLabels: Record<PullRequestCheck['bucket'], string> = {
  pass: 'Réussi', fail: 'Échec', pending: 'En cours', skipping: 'Ignoré', cancel: 'Annulé',
}
const stateLabels = { OPEN: 'Ouverte', CLOSED: 'Fermée', MERGED: 'Fusionnée' }

type Target = { projectId: string; worktreePath: string }
type Draft = { title: string; body: string }

export function PullRequestPanel({ projectId, worktreePath, branch }: Target & { branch: string | null }) {
  const [drafts, setDrafts] = useState(() => new Map<string, Draft>())
  return <BranchPullRequestPanel
    key={branch} projectId={projectId} worktreePath={worktreePath} drafts={drafts} setDrafts={setDrafts}
  />
}

function BranchPullRequestPanel({ projectId, worktreePath, drafts, setDrafts }: Target & {
  drafts: Map<string, Draft>
  setDrafts: Dispatch<SetStateAction<Map<string, Draft>>>
}) {
  const [context, setContext] = useState<PullRequestContext>()
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [created, setCreated] = useState<{ branch: string; url: string }>()
  const refreshInProgress = useRef(false)
  const refresh = useCallback(async () => {
    if (refreshInProgress.current) return
    refreshInProgress.current = true
    setRefreshing(true)
    try {
      const next = await window.wu.invoke('review:pr', { projectId, worktreePath })
      setContext(next)
      // Une fois la PR affichée, sa fermeture doit rendre le formulaire accessible à nouveau.
      if (next.kind === 'existing') setCreated((previous) => previous?.url === next.url ? undefined : previous)
      setError('')
    } catch (cause) {
      setError(String(cause))
    } finally {
      refreshInProgress.current = false
      setRefreshing(false)
    }
  }, [projectId, worktreePath])

  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0)
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, REFRESH_INTERVAL_MS)
    return () => {
      clearTimeout(initial)
      clearInterval(poll)
    }
  }, [refresh])

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (context?.kind !== 'draft' || publishing || created?.branch === context.branch) return
    const data = new FormData(event.currentTarget)
    const savedDraft = drafts.get(context.branch)
    setPublishing(true)
    setError('')
    try {
      const { url } = await window.wu.invoke('review:createPr', {
        projectId, worktreePath, branch: context.branch,
        title: String(data.get('title') ?? ''), body: String(data.get('body') ?? ''),
      })
      setDrafts((previous) => {
        if (!savedDraft || previous.get(context.branch) !== savedDraft) return previous
        const next = new Map(previous)
        next.delete(context.branch)
        return next
      })
      setCreated({ branch: context.branch, url })
      await refresh()
    } catch (cause) {
      setError(String(cause))
    } finally {
      setPublishing(false)
    }
  }

  const draft = context?.kind === 'draft' ? drafts.get(context.branch) : undefined
  const pr = context?.kind === 'existing' ? context : undefined
  const prUrl = pr?.url ?? (context?.kind === 'draft' && created?.branch === context.branch ? created.url : '')
  return (
    <section aria-label="Pull request" className="pull-request-panel">
      <h2>Pull request</h2>
      {prUrl && (
        <p>
          <a href={prUrl} onClick={(event) => {
            event.preventDefault()
            void window.wu.invoke('shell:openUrl', { url: prUrl }).catch((cause: unknown) => setError(String(cause)))
          }}>
            {pr ? `PR #${pr.number} · ${pr.title}` : 'Ouvrir la PR dans le navigateur'}
          </a>
          {pr && <> · {stateLabels[pr.state]}</>}
        </p>
      )}
      {pr && (
        pr.checks.length ? (
          <ul aria-label="Vérifications CI">
            {pr.checks.map((check, index) => (
              <li key={`${check.name}-${index}`}>{check.name} · {checkLabels[check.bucket]}</li>
            ))}
          </ul>
        ) : <p>Aucune vérification CI.</p>
      )}
      {context?.kind === 'unavailable' && <p>{context.message}</p>}
      {context?.kind === 'draft' && !prUrl && (
        <form key={context.branch} onSubmit={(event) => void publish(event)} onChange={(event) => {
          const data = new FormData(event.currentTarget)
          setDrafts((previous) => new Map(previous).set(context.branch, {
            title: String(data.get('title') ?? ''), body: String(data.get('body') ?? ''),
          }))
        }}>
          <label>Titre de la PR<input name="title" defaultValue={draft?.title ?? context.title} required maxLength={256} /></label>
          <label>Description de la PR<textarea name="body" defaultValue={draft?.body ?? context.body} rows={6} maxLength={20_000} /></label>
          <button type="submit" disabled={publishing}>{publishing ? 'Création…' : 'Créer la PR'}</button>
        </form>
      )}
      {error && <p role="status">{error}</p>}
      <button type="button" disabled={refreshing || publishing} onClick={() => void refresh()}>
        Rafraîchir la PR
      </button>
    </section>
  )
}
