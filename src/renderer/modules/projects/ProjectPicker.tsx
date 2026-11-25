import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { findCommands, registerCommand } from '../palette/commands'
import { worktreeLabel, type Workspace } from './workspace'

type Choice = { key: string; title: string; projectId: string; path: string }

export function ProjectPicker({ workspace }: { workspace: Workspace }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const ranks = new Map(workspace.recent.map((key, index) => [key, index]))
  const rank = (key: string) => ranks.get(key) ?? workspace.recent.length
  const choices = workspace.groups.flatMap(({ project, worktrees }) => {
    const main = worktrees.find((worktree) => worktree.main) ?? worktrees[0]
    if (!main) return []
    return [
      { key: `project:${project.id}`, title: project.name, projectId: project.id, path: main.path },
      ...worktrees.map((worktree) => ({
        key: `worktree:${worktree.path}`,
        title: `${project.name} · ${worktreeLabel(worktree)}`,
        projectId: project.id,
        path: worktree.path,
      })),
    ]
  })
  choices.sort((a, b) => rank(a.key) - rank(b.key))
  const matches = findCommands(choices, query)
  const index = Math.min(active, matches.length - 1)
  const selected = matches[index]
  const activeId = selected && `${listId}-${index}`

  const show = useCallback(() => {
    if (!dialog.current || dialog.current.open) return
    setActive(0)
    setQuery('')
    dialog.current.showModal()
    input.current?.focus()
  }, [])

  useEffect(
    () =>
      registerCommand({
        id: 'projects.switch',
        title: 'Changer de projet ou de worktree',
        keybinding: 'Ctrl+Shift+O',
        run: show,
      }),
    [show],
  )

  useEffect(() => {
    if (dialog.current?.open && activeId)
      document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  function select(choice: Choice) {
    workspace.expand(choice.projectId, true)
    workspace.select(choice.path, choice.key)
    dialog.current?.close()
  }

  return (
    <dialog ref={dialog} className="command-palette" aria-label="Projets et worktrees">
      <h2>Projets et worktrees</h2>
      <input
        ref={input}
        role="combobox"
        aria-label="Rechercher un projet ou un worktree"
        aria-expanded="true"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-activedescendant={activeId}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
        }}
        onKeyDown={(event) => {
          if (!selected || event.nativeEvent.isComposing) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const delta = event.key === 'ArrowDown' ? 1 : -1
            setActive((index + delta + matches.length) % matches.length)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            select(selected)
          }
        }}
      />
      <ul id={listId} role="listbox" aria-label="Résultats">
        {matches.map((choice, index) => (
          <li
            key={choice.key}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={choice === selected}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => select(choice)}
            title={choice.path}
          >
            {choice.title}
          </li>
        ))}
      </ul>
      {matches.length === 0 && <p role="status">Aucun projet ou worktree trouvé.</p>}
    </dialog>
  )
}
