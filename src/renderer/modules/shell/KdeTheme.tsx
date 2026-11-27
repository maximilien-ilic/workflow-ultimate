import { useCallback, useEffect, useState } from 'react'
import { registerCommand } from '../palette/commands'

const storageKey = 'wu.follow-kde-theme'
const refreshIntervalMs = 1_000

function readPreference(): boolean {
  try {
    return localStorage.getItem(storageKey) === 'true'
  } catch {
    return false
  }
}

export function KdeTheme({ controls = false }: { controls?: boolean }) {
  const [enabled, setEnabled] = useState(readPreference)
  const toggle = useCallback(() => {
    const next = !enabled
    try {
      localStorage.setItem(storageKey, String(next))
    } catch {
      // L’option reste utilisable tant que la fenêtre est ouverte.
    }
    setEnabled(next)
  }, [enabled])

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setEnabled(readPreference())
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  useEffect(() => {
    if (!controls) return
    return registerCommand({
      id: 'shell.follow-kde-theme',
      title: enabled ? 'Utiliser le thème de l’application' : 'Suivre le thème KDE',
      run: toggle,
    })
  }, [controls, enabled, toggle])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let checking = false
    const root = document.documentElement
    const setColor = (property: string, value?: string) => {
      if (value) root.style.setProperty(property, value)
      else root.style.removeProperty(property)
    }
    async function sync() {
      if (checking) return
      checking = true
      try {
        const { background, foreground, accent, scheme } = await window.wu.invoke('shell:kdePalette', {})
        if (cancelled) return
        root.toggleAttribute('data-kde-theme', Boolean(background || accent))
        setColor('--bg', background)
        setColor('--fg', foreground)
        setColor('--accent', accent)
        setColor('color-scheme', scheme)
      } catch (error) {
        console.warn('Lecture du thème KDE impossible', error)
      } finally {
        checking = false
      }
    }
    void sync()
    const timer = window.setInterval(() => void sync(), refreshIntervalMs)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      root.removeAttribute('data-kde-theme')
      for (const property of ['--bg', '--fg', '--accent', 'color-scheme']) setColor(property)
    }
  }, [enabled])

  return controls ? (
    <label className="kde-theme-option">
      <input type="checkbox" checked={enabled} onChange={toggle} /> Suivre le thème KDE
    </label>
  ) : null
}
