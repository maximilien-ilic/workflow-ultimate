import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { KdePalette } from '../../../shared/ipc'
import { handle } from './ipc'
import { appDirectory } from './paths'

function parseColor(value: string | undefined): { css: string; light: boolean } | undefined {
  if (!value || !/^\d{1,3},\s*\d{1,3},\s*\d{1,3}(?:,\s*255)?$/.test(value)) return
  const [red = 0, green = 0, blue = 0] = value.split(',').map(Number)
  if (red > 255 || green > 255 || blue > 255) return
  return {
    css: `rgb(${red}, ${green}, ${blue})`,
    light: 0.2126 * red + 0.7152 * green + 0.0722 * blue >= 128,
  }
}

function parsePalette(text: string): KdePalette {
  // shortcut: lire les couleurs écrites dans kdeglobals ; utiliser KConfig si les couches système
  // ou des directives de configuration avancées deviennent nécessaires.
  const entries = new Map<string, string>()
  let group = ''
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const header = /^\[([^\]]+)\]$/.exec(line)
    if (header) {
      group = header[1]!
      continue
    }
    if (line.startsWith('#') || line.startsWith(';')) continue
    const equals = line.indexOf('=')
    if (equals > 0) entries.set(`${group}/${line.slice(0, equals).trim()}`, line.slice(equals + 1).trim())
  }

  const background = parseColor(entries.get('Colors:Window/BackgroundNormal'))
  const foreground = parseColor(entries.get('Colors:Window/ForegroundNormal'))
  const accent = parseColor(entries.get('General/AccentColor')) ??
    parseColor(entries.get('Colors:Selection/BackgroundNormal'))
  return {
    accent: accent?.css,
    ...(background && foreground ? {
      background: background.css,
      foreground: foreground.css,
      scheme: background.light ? 'light' : 'dark',
    } : {}),
  }
}

export function registerKdePalette(): void {
  handle('shell:kdePalette', async () => {
    const path = join(dirname(appDirectory('config')), 'kdeglobals')
    const contents = await readFile(path, 'utf8').catch(() => '')
    return parsePalette(contents)
  })
}
