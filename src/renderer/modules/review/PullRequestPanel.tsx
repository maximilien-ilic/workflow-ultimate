import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { PullRequestCheck, PullRequestContext } from '../../../shared/ipc'
import './pull-request.css'

const REFRESH_INTERVAL_MS = 30_000
const checkLabels: Record<PullRequestCheck['bucket'], string> = {
  pass: 'Réussi', fail: 'Échec', pending: 'En cours', skipping: 'Ignoré', cancel: 'Annulé',
}
const stateLabels = { OPEN: 'Ouverte', CLOSED: 'Fermée', MERGED: 'Fusionnée' }

export function PullRequestPanel({ projectId, worktreePath }: { projectId: string; worktreePath: string }) {
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
      setContext(await window.wu.invoke('review:pr', { projectId, worktreePath }))
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
    setPublishing(true)
    setError('')
    try {
      const { url } = await window.wu.invoke('review:createPr', {
        projectId, worktreePath, branch: context.branch,
        title: String(data.get('title') ?? ''), body: String(data.get('body') ?? ''),
      })
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
      {context?.kind === 'draft' && !prUrl && (
        <form key={context.branch} onSubmit={(event) => void publish(event)}>
          <label>Titre de la PR<input name="title" defaultValue={context.title} required maxLength={256} /></label>
          <label>Description de la PR<textarea name="body" defaultValue={context.body} rows={6} maxLength={20_000} /></label>
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
