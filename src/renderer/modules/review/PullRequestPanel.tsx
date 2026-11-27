import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { PullRequestCheck, PullRequestContext } from '../../../shared/ipc'
import './pull-request.css'

const REFRESH_INTERVAL_MS = 30_000
const checkLabels: Record<PullRequestCheck['bucket'], string> = {
  pass: 'Réussi', fail: 'Échec', pending: 'En cours', skipping: 'Ignoré', cancel: 'Annulé',
}
const stateLabels = { OPEN: 'Ouverte', CLOSED: 'Fermée', MERGED: 'Fusionnée' }

type Target = { projectId: string; worktreePath: string }
type Draft = { title: string; body: string }

// Le panneau est démonté lors du masquage ou d’un changement de worktree.
const drafts = new Map<string, Draft>()

function readDraft(form: HTMLFormElement): Draft {
  const data = new FormData(form)
  return { title: String(data.get('title') ?? ''), body: String(data.get('body') ?? '') }
}

export function PullRequestPanel({ projectId, worktreePath, branch }: Target & { branch: string | null }) {
  return <BranchPullRequestPanel key={branch} projectId={projectId} worktreePath={worktreePath} />
}

function BranchPullRequestPanel({ projectId, worktreePath }: Target) {
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

  const draftKey = context?.kind === 'draft' ? JSON.stringify([projectId, worktreePath, context.branch]) : undefined
  const draft = draftKey ? drafts.get(draftKey) : undefined

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draftKey || context?.kind !== 'draft' || publishing || created?.branch === context.branch) return
    const fields = readDraft(event.currentTarget)
    const savedDraft = drafts.get(draftKey)
    setPublishing(true)
    setError('')
    try {
      const { url } = await window.wu.invoke('review:createPr', {
        projectId, worktreePath, branch: context.branch, ...fields,
      })
      if (drafts.get(draftKey) === savedDraft) drafts.delete(draftKey)
      setCreated({ branch: context.branch, url })
      await refresh()
    } catch (cause) {
      setError(String(cause))
    } finally {
      setPublishing(false)
    }
  }

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
      {context?.kind === 'draft' && draftKey && !prUrl && (
        <form key={draftKey} onSubmit={(event) => void publish(event)} onChange={(event) => {
          drafts.set(draftKey, readDraft(event.currentTarget))
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
