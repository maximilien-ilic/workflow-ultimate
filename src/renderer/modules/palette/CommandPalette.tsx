import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { normalizeKeybinding, paletteKeybinding, type Keybindings } from '../../../shared/keybindings'
import { commandKeybinding, commandRegistry, findCommands, shortcutConflict, type Command } from './commands'
import './palette.css'

function eventKeybinding(event: KeyboardEvent): string | null {
  if (event.getModifierState('AltGraph')) return null
  if (!event.ctrlKey && !event.altKey && !event.metaKey) return null
  const key = /^Digit[0-9]$/.test(event.code) ? event.code.at(-1) : event.key
  return normalizeKeybinding(
    [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta', key]
      .filter(Boolean)
      .join('+'),
  )
}

export function CommandPalette({
  enabled,
  keybindings,
  onKeybindingChange,
}: {
  enabled: boolean
  keybindings: Keybindings
  onKeybindingChange: (id: string, keybinding: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const listId = useId()
  const commands = useSyncExternalStore(commandRegistry.subscribe, commandRegistry.getCommands)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [editing, setEditing] = useState<Command | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const matches = findCommands(commands, query)
  const selected = matches[Math.min(active, matches.length - 1)]
  const selectedId = selected && `${listId}-${selected.id}`

  const show = useCallback(() => {
    if (!dialog.current || dialog.current.open) return
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setQuery('')
    setActive(0)
    setEditing(null)
    setError('')
    dialog.current.showModal()
    search.current?.focus()
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!enabled || event.defaultPrevented || event.repeat || event.isComposing) return
      const binding = eventKeybinding(event)
      if (!binding || dialog.current?.open) return
      if (binding === paletteKeybinding) {
        event.preventDefault()
        show()
        return
      }

      const command = commands.find((entry) => commandKeybinding(entry, keybindings) === binding)
      if (command) {
        event.preventDefault()
        command.run()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commands, enabled, keybindings, show])

  useEffect(() => {
    if (dialog.current?.open && selectedId) {
      document.getElementById(selectedId)?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedId])

  function run(command: Command) {
    dialog.current?.close()
    command.run()
  }

  return (
    <>
      <button ref={opener} type="button" disabled={!enabled} onClick={show}>
        Commandes ({paletteKeybinding})
      </button>
      <dialog
        ref={dialog}
        className="command-palette"
        aria-labelledby={titleId}
        onClose={() => {
          const previous = previousFocus.current
          if (previous && previous !== document.body && previous.isConnected) previous.focus()
          else opener.current?.focus()
        }}
      >
        <h2 id={titleId}>Palette de commandes</h2>
        <input
          ref={search}
          type="text"
          role="combobox"
          aria-label="Rechercher une commande"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={selectedId}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={(event) => {
            if (!selected || event.nativeEvent.isComposing) return
            const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
            if (delta) {
              event.preventDefault()
              setActive(
                (index) => (Math.min(index, matches.length - 1) + delta + matches.length) % matches.length,
              )
            } else if (event.key === 'Enter') {
              event.preventDefault()
              run(selected)
            }
          }}
        />
        <ul id={listId} role="listbox" aria-label="Commandes">
          {matches.map((command) => (
            <li
              key={command.id}
              id={`${listId}-${command.id}`}
              role="option"
              aria-selected={command === selected}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => run(command)}
            >
              {command.title}
              <kbd>{commandKeybinding(command, keybindings)}</kbd>
            </li>
          ))}
        </ul>
        {!matches.length && <p role="status">Aucune commande trouvée.</p>}
        <div className="palette-actions">
          <button
            type="button"
            disabled={!selected}
            onClick={() => {
              if (!selected) return
              setEditing(selected)
              setDraft(commandKeybinding(selected, keybindings) ?? '')
              setError('')
            }}
          >
            Modifier le raccourci
          </button>
          <button type="button" onClick={() => dialog.current?.close()}>
            Fermer
          </button>
        </div>
        {editing && (
          <form
            key={editing.id}
            onSubmit={(event) => {
              event.preventDefault()
              const keybinding = normalizeKeybinding(draft)
              if (!keybinding) {
                setError('Saisissez une combinaison comme Ctrl+J.')
                return
              }
              const conflict = shortcutConflict(commands, keybindings, editing.id, keybinding)
              if (conflict) {
                setError(`Raccourci déjà utilisé par « ${conflict} ».`)
                return
              }
              onKeybindingChange(editing.id, keybinding)
              setEditing(null)
              search.current?.focus()
            }}
          >
            <label>
              Nouveau raccourci
              <input
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Ctrl+J"
              />
            </label>
            <button type="submit">Enregistrer</button>
            {error && <p role="alert">{error}</p>}
          </form>
        )}
      </dialog>
    </>
  )
}
