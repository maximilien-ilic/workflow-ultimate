import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChangedFile } from '../../../shared/ipc'
import { agentStore, startAgent } from '../agents/agent-store'
import { registerCommand } from '../palette/commands'
import { CommitForm } from './CommitForm'
import { ReviewComments } from './ReviewComments'
import { terminalStore } from '../terminals/terminal-store'
import './review.css'

type Target = {
  request: number
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

function clearVersions(diff: import('monaco-editor').editor.IStandaloneDiffEditor) {
  const model = diff.getModel()
  diff.setModel(null)
  model?.original.dispose()
  model?.modified.dispose()
}

function showVersions(
  monaco: Monaco,
  diff: import('monaco-editor').editor.IStandaloneDiffEditor,
  path: string,
  versions: { before: string; after: string },
) {
  const language = languageOf(monaco, path)
  diff.setModel({
    original: monaco.editor.createModel(versions.before, language),
    modified: monaco.editor.createModel(versions.after, language),
  })
}

// Worktree du terminal actif : celui dont le chemin est le dossier courant de l'onglet.
async function activeWorktree(): Promise<{ projectId: string; worktreePath: string } | null> {
  const cwd = terminalStore.activeCwd()
  if (!cwd) return null
  for (const project of await window.wu.invoke('projects:list', {})) {
    const worktrees = await window.wu.invoke('worktrees:list', { projectId: project.id }).catch(() => [])
    if (worktrees.some((w) => w.path === cwd)) return { projectId: project.id, worktreePath: cwd }
  }
  return null
}

// Diff du worktree actif (Ctrl+Shift+G) : fichiers à gauche, diff Monaco à droite, Alt+↓/↑ pour naviguer.
export function ReviewView() {
  const dialog = useRef<HTMLDialogElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<import('monaco-editor').editor.IStandaloneDiffEditor | null>(null)
  const opening = useRef(0)
  const [target, setTarget] = useState<Target | null>(null)
  const [selected, setSelected] = useState(0)
  const [inline, setInline] = useState(false)
  const inlineRef = useRef(inline)
  const [message, setMessage] = useState('')
  const [fileMessage, setFileMessage] = useState('')
  const [anchor, setAnchor] = useState<{ file: ChangedFile; line: number; maxLine: number }>()

  const [excluded, setExcluded] = useState<Set<string>>(new Set()) // fichiers décochés pour le commit

  const loadChanges = useCallback(async (wt: { projectId: string; worktreePath: string }, request: number) => {
    const modal = dialog.current
    if (request !== opening.current || !modal?.open) return
    setFileMessage('')
    try {
      const changes = await window.wu.invoke('review:changes', wt)
      if (request !== opening.current || !modal.open) return
      setTarget({ ...wt, ...changes, request })
      setSelected(0)
      setExcluded(new Set())
      setMessage(changes.files.length === 0 ? `Aucun changement par rapport à ${changes.base}.` : '')
    } catch (e) {
      if (request === opening.current && modal.open) setMessage(String(e))
    }
  }, [])

  const open = useCallback(async () => {
    const request = ++opening.current
    const modal = dialog.current
    if (!modal) return
    if (!modal.open) modal.showModal()
    setTarget(null)
    setMessage('')
    setFileMessage('')
    try {
      const wt = await activeWorktree()
      if (request !== opening.current || !modal.open) return
      if (wt) await loadChanges(wt, request)
      else setMessage(MESSAGE_NO_WORKTREE)
    } catch (e) {
      if (request === opening.current && modal.open) setMessage(String(e))
    }
  }, [loadChanges])

  const toggleIncluded = (path: string) =>
    setExcluded((previous) => {
      const next = new Set(previous)
      if (!next.delete(path)) next.add(path)
      return next
    })
  const checkedPaths = [...new Set(target?.files
    .filter((file) => !excluded.has(file.path))
    .flatMap(({ path, oldPath }) => oldPath ? [oldPath, path] : [path]))]

  const suggestMessage = async () => {
    if (!target) return
    const title = 'Message de commit'
    const prompt = 'Propose un message de commit pour les changements non commités des fichiers sélectionnés. '
      + 'Réponds avec le message seul, sans modifier le dépôt ni créer de commit. '
      + `Fichiers (liste JSON) : ${JSON.stringify(checkedPaths)}`
    const active = terminalStore.activePane()
    const agent = active ? agentStore.get(active)?.agent : undefined
    const terminalId = await startAgent(target.worktreePath, title, { agent, prompt })
    if (target.request === opening.current) dialog.current?.close()
    terminalStore.openAttachedTab(target.worktreePath, title, terminalId)
  }

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
  useLayoutEffect(() => {
    inlineRef.current = inline
    editor.current?.updateOptions({ renderSideBySide: !inline })
  }, [inline])

  useLayoutEffect(() => {
    if (!target || !file || !host.current) return
    let cancelled = false
    let cursorListener: { dispose(): void } | undefined
    const container = host.current
    const request = opening.current
    const stillSelected = () => !cancelled && request === opening.current && dialog.current?.open
    void (async () => {
      const [{ monaco }, versions] = await Promise.all([
        import('./monaco'),
        window.wu.invoke('review:file', {
          projectId: target.projectId,
          worktreePath: target.worktreePath,
          mergeBase: target.mergeBase,
          file,
        }),
      ])
      if (!stillSelected()) return
      if (!versions.binary) {
        editor.current ??= createDiffEditor(monaco, container, inlineRef.current)
        showVersions(monaco, editor.current, file.path, versions)
        const side = file.status === 'deleted' ? editor.current.getOriginalEditor() : editor.current.getModifiedEditor()
        const maxLine = side.getModel()?.getLineCount() ?? 1
        setAnchor({ file, line: 1, maxLine })
        cursorListener = side.onDidChangeCursorPosition(({ position }) => {
          setAnchor({ file, line: position.lineNumber, maxLine })
        })
      }
      setFileMessage(versions.binary ? MESSAGE_BINARY : '')
    })().catch((e: unknown) => {
      if (stillSelected()) setFileMessage(String(e))
    })
    return () => {
      cancelled = true
      cursorListener?.dispose()
      if (editor.current) clearVersions(editor.current)
    }
  }, [target, file])

  useLayoutEffect(() => () => {
    if (editor.current) {
      clearVersions(editor.current)
      editor.current.dispose()
      editor.current = null
    }
  }, [])

  const count = target?.files.length ?? 0
  const fileStatus = file && fileMessage
  const activeAnchor = anchor?.file === file ? anchor : undefined
  return (
    <dialog
      ref={dialog}
      className="review"
      aria-label="Diff du worktree"
      onKeyDown={(e) => {
        if (!e.altKey || count === 0) return
        if (e.target instanceof Element && e.target.closest('.review-comments')) return
        if (e.key === 'ArrowDown') setSelected((i) => (i + 1) % count)
        else if (e.key === 'ArrowUp') setSelected((i) => (i - 1 + count) % count)
        else return
        if (count > 1) setFileMessage('')
        e.preventDefault()
      }}
      onClose={(event) => {
        if (event.currentTarget.open) return
        opening.current++
        setTarget(null)
        setFileMessage('')
        if (editor.current) {
          clearVersions(editor.current)
          editor.current.dispose()
          editor.current = null
        }
      }}
    >
      <header>
        <h2>Diff {target ? `par rapport à ${target.base}` : ''}</h2>
        <button onClick={() => setInline((v) => !v)}>{inline ? 'Côte à côte' : 'En ligne'}</button>
        <button onClick={() => dialog.current?.close()}>Fermer</button>
      </header>
      {(message || fileStatus) && <p role="status">{message || fileStatus}</p>}
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
                onClick={() => {
                  if (i !== selected) setFileMessage('')
                  setSelected(i)
                }}
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
      {target && (
        <ReviewComments
          key={target.request}
          projectId={target.projectId}
          worktreePath={target.worktreePath}
          filePath={file?.path}
          line={activeAnchor?.line ?? 1}
          maxLine={activeAnchor?.maxLine}
        />
      )}
      {target && (
        <CommitForm
          projectId={target.projectId}
          worktreePath={target.worktreePath}
          checkedPaths={checkedPaths}
          onCommitted={() => loadChanges({ projectId: target.projectId, worktreePath: target.worktreePath }, target.request)}
          onSuggestMessage={suggestMessage}
        />
      )}
    </dialog>
  )
}
