import { describe, expect, it, vi } from 'vitest'
import { createCommandRegistry, findCommands, shortcutConflict } from './commands'
import { normalizeKeybinding } from '../../../shared/keybindings'

const left = { id: 'left', title: 'Basculer la barre latérale', keybinding: 'Ctrl+B', run: vi.fn() }
const right = { id: 'right', title: 'Panneau de contexte', keybinding: 'Ctrl+Alt+B', run: vi.fn() }

describe('command registry', () => {
  it('enregistre, exécute et désenregistre une commande', () => {
    const registry = createCommandRegistry()
    const listener = vi.fn()
    const unsubscribe = registry.subscribe(listener)
    const remove = registry.registerCommand(left)
    expect(registry.getCommands()).toEqual([left])
    registry.getCommands()[0]?.run()
    expect(left.run).toHaveBeenCalledOnce()
    expect(() => registry.registerCommand(left)).toThrow(/left/)
    remove()
    expect(registry.getCommands()).toEqual([])
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('détecte les raccourcis réservés ou déjà utilisés après personnalisation', () => {
    expect(shortcutConflict([left, right], {}, left.id, 'Ctrl+Shift+P')).toBe('Palette de commandes')
    expect(shortcutConflict([left, right], { right: 'Ctrl+J' }, left.id, 'Ctrl+J')).toBe(right.title)
    expect(shortcutConflict([left, right], { right: 'Ctrl+J' }, left.id, 'Ctrl+Alt+B')).toBeUndefined()
    expect(shortcutConflict([left, right], {}, left.id, 'Ctrl+B')).toBeUndefined()
  })
})

describe('findCommands', () => {
  it('ignore les accents et accepte les caractères non contigus dans l’ordre', () => {
    expect(findCommands([left, right], 'LATERALE')).toEqual([left])
    expect(findCommands([left, right], 'pxte')).toEqual([right])
    expect(findCommands([left, right], 'xyz')).toEqual([])
    expect(findCommands([left, right], '  ')).toEqual([left, right])
  })

  it('classe une correspondance contiguë avant une correspondance dispersée', () => {
    const exact = { ...left, id: 'exact', title: 'Contexte' }
    expect(findCommands([right, exact], 'con')).toEqual([exact, right])
  })
})

describe('normalizeKeybinding', () => {
  it('normalise l’ordre, les espaces et la casse des modificateurs', () => {
    expect(normalizeKeybinding(' shift + alt + ctrl + b ')).toBe('Ctrl+Alt+Shift+B')
  })

  it('rejette les caractères seuls, les doublons et les accords incomplets', () => {
    for (const input of ['B', 'Shift+B', 'Ctrl+Ctrl+B', 'Ctrl+', 'Ctrl+B+C']) {
      expect(normalizeKeybinding(input)).toBeNull()
    }
  })
})
