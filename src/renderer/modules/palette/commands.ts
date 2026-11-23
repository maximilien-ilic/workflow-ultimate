import { paletteKeybinding, type Keybindings } from '../../../shared/keybindings'

export type Command = {
  id: string
  title: string
  keybinding?: string
  run: () => void
}

export function createCommandRegistry() {
  let commands: readonly Command[] = []
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())

  return {
    getCommands: () => commands,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    registerCommand(command: Command) {
      if (commands.some(({ id }) => id === command.id)) {
        throw new Error(`Commande déjà enregistrée (${command.id})`)
      }
      commands = [...commands, command]
      notify()
      return () => {
        if (!commands.includes(command)) return
        commands = commands.filter((entry) => entry !== command)
        notify()
      }
    },
  }
}

export const commandRegistry = createCommandRegistry()
export const { registerCommand } = commandRegistry

export function commandKeybinding(command: Command, overrides: Keybindings): string | undefined {
  return overrides[command.id] ?? command.keybinding
}

export function shortcutConflict(
  commands: readonly Command[],
  overrides: Keybindings,
  id: string,
  keybinding: string,
): string | undefined {
  if (keybinding === paletteKeybinding) return 'Palette de commandes'
  return commands.find((other) => other.id !== id && commandKeybinding(other, overrides) === keybinding)
    ?.title
}

const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

function fuzzyScore(title: string, query: string): number {
  const contiguous = title.indexOf(query)
  if (contiguous !== -1) return contiguous

  let position = -1
  for (const letter of query.replace(/\s/g, '')) {
    position = title.indexOf(letter, position + 1)
    if (position === -1) return Infinity
  }
  return title.length + position
}

export function findCommands<T extends Pick<Command, 'title'>>(
  commands: readonly T[],
  query: string,
): readonly T[] {
  const search = normalize(query.trim())
  if (!search) return commands
  return commands
    .map((command) => ({ command, score: fuzzyScore(normalize(command.title), search) }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => a.score - b.score)
    .map(({ command }) => command)
}
