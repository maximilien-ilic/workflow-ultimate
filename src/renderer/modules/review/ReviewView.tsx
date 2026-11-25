import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangedFile } from '../../../shared/ipc'
import { registerCommand } from '../palette/commands'
import { CommitForm } from './CommitForm'
import { terminalStore } from '../terminals/terminal-store'
import './review.css'

type Target = {
  projectId: string
  worktreePath: string
  mergeBase: string
  base: string
  files: ChangedFile[]
}
type Monaco = (typeof import('./monaco'))['monaco']

const statusLetter: Record<ChangedFile['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
}
const statusText: Record<ChangedFile['status'], string> = {
  added: 'ajouté',
  modified: 'modifié',
  deleted: 'supprimé',
  renamed: 'renommé',
}

const MESSAGE_BINARY = 'Fichier binaire ou trop gros : pas de diff affiché.'
const MESSAGE_NO_WORKTREE = "Ouvrez d'abord un terminal dans un worktree d'un projet."

function createDiffEditor(monaco: Monaco, container: HTMLElement, inline: boolean) {
  return monaco.editor.createDiffEditor(container, {
    readOnly: true,
    automaticLayout: true,
    renderSideBySide: !inline,
    originalEditable: false,
    stickyScroll: { enabled: false }, // inutile pour lire un diff
  })
}

function languageOf(monaco: Monaco, path: string): string | undefined {
  return monaco.languages
    .getLanguages()
    .find((language: { extensions?: string[] }) => language.extensions?.some((ext) => path.endsWith(ext)))?.id
}

// Remplace les deux versions affichées et libère les anciennes (Monaco ne les libère pas seul).
function showVersions(
  monaco: Monaco,
  diff: import('monaco-editor').editor.IStandaloneDiffEditor,
  path: string,
  versions: { before: string; after: string },
) {
  const language = languageOf(monaco, path)
  const previous = diff.getModel()
  diff.setModel({
    original: monaco.editor.createModel(versions.before, language),
    modified: monaco.editor.createModel(versions.after, language),
  })
  previous?.original.dispose()
  previous?.modified.dispose()
}

// Worktree du terminal actif : celui dont le chemin est le dossier courant de l'onglet.
async function activeWorktree(): Promise<{ projectId: string; worktreePath: string } | null> {
  const cwd = terminalStore.activeCwd()
  if (!cwd) return null
  for (const project of await window.wu.invoke('projects:list', {})) {
    const worktrees = await window.wu.invoke('worktrees:list', { projectId: project.id })
    if (worktrees.some((w) => w.path === cwd)) return { projectId: project.id, worktreePath: cwd }
  }
  return null
}

// Diff du worktree actif (Ctrl+Shift+G) : fichiers à gauche, diff Monaco à droite, Alt+↓/↑ pour naviguer.
export function ReviewView() {
  const dialog = useRef<HTMLDialogElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<import('monaco-editor').editor.IStandaloneDiffEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const [target, setTarget] = useState<Target | null>(null)
  const [selected, setSelected] = useState(0)
  const [inline, setInline] = useState(false)
  const [message, setMessage] = useState('')

  const [excluded, setExcluded] = useState<Set<string>>(new Set()) // fichiers décochés pour le commit

  const loadChanges = useCallback(async (wt: { projectId: string; worktreePath: string }) => {
    try {
      const changes = await window.wu.invoke('review:changes', wt)
      setTarget({ ...wt, ...changes })
      setSelected(0)
      setExcluded(new Set())
      setMessage(changes.files.length === 0 ? `Aucun changement par rapport à ${changes.base}.` : '')
    } catch (e) {
      setMessage(String(e))
    }
  }, [])

  const open = useCallback(async () => {
    const wt = await activeWorktree()
    setTarget(null)
    setMessage(wt ? '' : MESSAGE_NO_WORKTREE)
    if (wt) await loadChanges(wt)
    dialog.current?.showModal()
  }, [loadChanges])

  const toggleIncluded = (path: string) =>
    setExcluded((previous) => {
      const next = new Set(previous)
      if (!next.delete(path)) next.add(path)
      return next
    })
  const checkedPaths = target?.files.filter((f) => !excluded.has(f.path)).map((f) => f.path) ?? []

  useEffect(
    () =>
      registerCommand({
        id: 'review.open',
        title: 'Voir le diff du worktree',
        keybinding: 'Ctrl+Shift+G',
        run: () => void open(),
      }),
    [open],
  )

  // Affiche le fichier sélectionné (Monaco chargé à la première ouverture seulement).
  const file = target?.files[selected]
  useEffect(() => {
    if (!target || !file || !host.current) return
    let cancelled = false
    const container = host.current
    void (async () => {
      const monaco = (monacoRef.current ??= (await import('./monaco')).monaco)
      const versions = await window.wu.invoke('review:file', {
        projectId: target.projectId,
        worktreePath: target.worktreePath,
        mergeBase: target.mergeBase,
        file,
      })
      if (cancelled) return
      editor.current ??= createDiffEditor(monaco, container, inline)
      showVersions(monaco, editor.current, file.path, versions)
      setMessage(versions.binary ? MESSAGE_BINARY : '')
    })().catch((e: unknown) => setMessage(String(e)))
    return () => {
      cancelled = true
    }
  }, [target, file, inline])

  useEffect(() => editor.current?.updateOptions({ renderSideBySide: !inline }), [inline])

  const count = target?.files.length ?? 0
  return (
    <dialog
      ref={dialog}
      className="review"
      aria-label="Diff du worktree"
      onKeyDown={(e) => {
        if (!e.altKey || count === 0) return
        if (e.key === 'ArrowDown') setSelected((i) => (i + 1) % count)
        else if (e.key === 'ArrowUp') setSelected((i) => (i - 1 + count) % count)
        else return
        e.preventDefault()
      }}
      onClose={() => {
        const model = editor.current?.getModel()
        editor.current?.dispose()
        model?.original.dispose()
        model?.modified.dispose()
        editor.current = null
      }}
    >
      <header>
        <h2>Diff {target ? `par rapport à ${target.base}` : ''}</h2>
        <button onClick={() => setInline((v) => !v)}>{inline ? 'Côte à côte' : 'En ligne'}</button>
        <button onClick={() => dialog.current?.close()}>Fermer</button>
      </header>
      {message && <p role="status">{message}</p>}
      <div className="review-body">
        <ul aria-label="Fichiers modifiés">
          {target?.files.map((f, i) => (
            <li key={f.path}>
              <input
                type="checkbox"
                aria-label={`Inclure ${f.path} dans le commit`}
                checked={!excluded.has(f.path)}
                onChange={() => toggleIncluded(f.path)}
              />
              <button
                aria-current={i === selected}
                onClick={() => setSelected(i)}
                title={statusText[f.status]}
              >
                <span aria-hidden="true">{statusLetter[f.status]}</span> {f.oldPath ? `${f.oldPath} → ` : ''}
                {f.path}
              </button>
            </li>
          ))}
        </ul>
        <div ref={host} className="review-editor" />
      </div>
      {target && target.files.length > 0 && (
        <CommitForm
          projectId={target.projectId}
          worktreePath={target.worktreePath}
          checkedPaths={checkedPaths}
          allChecked={excluded.size === 0}
          onCommitted={() => void loadChanges(target)}
        />
      )}
    </dialog>
  )
}
