import type { Terminal } from '@xterm/xterm'

export const mountedTerminals = new Map<string, Terminal>()

// Dernières lignes non vides affichées par un terminal (aperçu de la vue d'ensemble des agents).
export function lastLines(id: string, count: number): string[] {
  const buffer = mountedTerminals.get(id)?.buffer.active
  if (!buffer) return []
  const lines: string[] = []
  for (let i = buffer.length - 1; i >= 0 && lines.length < count; i--) {
    const line = buffer.getLine(i)?.translateToString(true) ?? ''
    if (line.trim()) lines.unshift(line)
  }
  return lines
}
