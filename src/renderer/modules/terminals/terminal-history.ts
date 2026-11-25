import { SerializeAddon } from '@xterm/addon-serialize'
import type { Terminal } from '@xterm/xterm'
import { HISTORY_CHARACTERS, HISTORY_LINES } from '../../../shared/terminal-history'

const SAVE_INTERVAL_MS = 5_000
export const RESTORED_SEPARATOR = '\x1b[0m\r\n\x1b[2m── session restaurée ──\x1b[0m\r\n'

const savers = new Map<string, (closing: boolean) => Promise<void>>()

function serializeHistory(term: Terminal, addon: SerializeAddon): string {
  const end = term.buffer.normal.length - 1
  let lines = Math.min(end + 1, HISTORY_LINES)
  while (lines > 0) {
    const data = addon.serialize({
      range: { start: end - lines + 1, end },
      excludeModes: true,
      excludeAltBuffer: true,
    })
    // shortcut: pour les sorties ANSI très denses, réduire le nombre de lignes pour borner l'IPC,
    // à remplacer par une sauvegarde découpée si la limite est atteinte en pratique.
    if (data.length <= HISTORY_CHARACTERS) return data
    lines = Math.floor(lines / 2)
  }
  return ''
}

export function trackTerminalHistory(id: string, term: Terminal, ready: () => boolean) {
  const addon = new SerializeAddon()
  term.loadAddon(addon)
  let dirty = true
  let disposed = false
  const parsed = term.onWriteParsed(() => {
    dirty = true
  })
  savers.set(id, async (closing) => {
    if (!ready() || (!closing && !dirty)) return
    // Une fermeture peut arriver avant que xterm ait traité son dernier lot de caractères.
    if (closing) await new Promise<void>((resolve) => term.write('', resolve))
    if (disposed) return
    dirty = false
    try {
      const data = serializeHistory(term, addon)
      await window.wu.invoke('terminal:saveHistory', { id, data, rows: term.rows, cols: term.cols })
    } catch (error) {
      dirty = true
      console.error('Sauvegarde du terminal impossible', error)
    }
  })
  return () => {
    disposed = true
    parsed.dispose()
    savers.delete(id)
  }
}

export function startTerminalHistory() {
  const save = (closing: boolean) => Promise.all([...savers.values()].map((save) => save(closing)))
  const timer = window.setInterval(() => void save(false), SAVE_INTERVAL_MS)
  window.wu.onTerminalHistoryFlush(() => {
    window.clearInterval(timer)
    void save(true)
      .finally(() => window.wu.invoke('terminal:historyFlushed', {}))
      .catch(console.error)
  })
}
