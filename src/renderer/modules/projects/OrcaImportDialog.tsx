import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { OrcaImport } from '../../../shared/ipc'
import { registerCommand } from '../palette/commands'
import type { Workspace } from './workspace'

export function OrcaImportDialog({ select, refresh }: Pick<Workspace, 'select' | 'refresh'>) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [preview, setPreview] = useState<OrcaImport | null>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [rejected, setRejected] = useState<string[]>([])

  const open = useCallback((source: OrcaImport | null) => {
    const element = dialog.current
    if (!element || element.open) return
    setPreview(source)
    setError('')
    setRejected([])
    element.showModal()
  }, [])

  useEffect(() => {
    let active = true
    void window.wu.invoke('projects:orcaPreview', { manual: false }).then(
      (source) => {
        if (active && source) open(source)
      },
      () => {},
    )
    const unregister = registerCommand({
      id: 'projects.import-orca',
      title: 'Réimporter depuis Orca',
      run() {
        void window.wu.invoke('projects:orcaPreview', { manual: true }).then(
          (source) => {
            if (active) open(source)
          },
          (error: unknown) => {
            if (!active) return
            open(null)
            setError(String(error))
          },
        )
      },
    })
    return () => {
      active = false
      unregister()
    }
  }, [open])

  function close() {
    if (busy) return
    dialog.current?.close()
    setPreview(undefined)
    // Une erreur d'écriture ne doit pas empêcher de fermer la fenêtre d'import.
    void window.wu.invoke('projects:orcaDismiss', {}).catch(console.warn)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      const result = await window.wu.invoke('projects:orcaImport', {
        repos: form.getAll('repo').map(String),
        worktrees: form.getAll('worktree').map(String),
        useWorkspace: form.has('workspace'),
      })
      if (result.activeWorktree) select(result.activeWorktree)
      await refresh()
      if (result.rejected.length > 0)
        setRejected(result.rejected.map(({ path, reason }) => `${path} : ${reason}`))
      else {
        dialog.current?.close()
        setPreview(undefined)
      }
    } catch (error) {
      setError(String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-label="Importer depuis Orca"
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
    >
      <h2>Importer depuis Orca</h2>
      {error && <p role="alert">{error}</p>}
      {rejected.length > 0 && (
        <ul aria-label="Éléments non importés">
          {rejected.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
      {preview === null && !error && <p>Aucun profil Orca détecté.</p>}
      {preview && (
        <form onSubmit={(event) => void submit(event)}>
          {preview.repos.length > 0 && (
            <fieldset>
              <legend>Projets</legend>
              {preview.repos.map((repo) => (
                <div key={repo.path}>
                  <label title={repo.path}>
                    <input name="repo" type="checkbox" value={repo.path} defaultChecked /> {repo.name}
                  </label>
                </div>
              ))}
            </fieldset>
          )}
          {preview.worktrees.length > 0 && (
            <fieldset>
              <legend>Worktrees existants</legend>
              <p>
                Un worktree sélectionné ajoute aussi son projet. La liste des worktrees est ensuite lue dans
                Git.
              </p>
              {preview.worktrees.map((worktree) => (
                <div key={worktree.path}>
                  <label title={worktree.path}>
                    <input name="worktree" type="checkbox" value={worktree.path} defaultChecked />{' '}
                    {worktree.name}
                  </label>
                </div>
              ))}
            </fieldset>
          )}
          {preview.workspaceDir && (
            <p>
              <label>
                <input name="workspace" type="checkbox" defaultChecked /> Utiliser le dossier des workspaces{' '}
                {preview.workspaceDir}
              </label>
            </p>
          )}
          {preview.warnings.length > 0 && (
            <ul aria-label="Avertissements Orca">
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          <button type="submit" disabled={busy}>
            Importer
          </button>{' '}
        </form>
      )}
      <button type="button" disabled={busy} onClick={close}>
        {preview ? 'Fermer' : 'OK'}
      </button>
    </dialog>
  )
}
