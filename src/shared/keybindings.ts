export const paletteKeybinding = 'Ctrl+Shift+P'

export const panelCommandBindings = {
  'shell.toggle-left': 'Ctrl+Shift+B',
  'shell.toggle-right': 'Ctrl+Alt+Shift+B',
}

export type Keybindings = Record<string, string>

const modifiers = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const

export function normalizeKeybinding(raw: string): string | null {
  const parts = raw.split('+').map((part) => part.trim().toLowerCase())
  const key = parts.pop()?.toUpperCase()
  if (!key || !/^[A-Z0-9]$/.test(key)) return null
  const included = modifiers.filter((modifier) => parts.includes(modifier.toLowerCase()))
  if (included.length !== parts.length || !included.some((modifier) => modifier !== 'Shift')) return null
  return [...included, key].join('+')
}
