import { useCallback, useEffect, useRef, useState } from 'react'
import { defaultSettings } from '../../../shared/layout-defaults'
import type { Settings } from '../../../shared/settings'

export function useSettings() {
  const current = useRef<Settings | null>(null)
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    window.wu.invoke('settings:get', {}).then(
      (saved) => {
        if (!active) return
        current.current = saved
        setSettings(saved)
        setReady(true)
      },
      (cause: unknown) => {
        if (active) setError(`Impossible de lire les réglages (${String(cause)})`)
      },
    )
    return () => {
      active = false
    }
  }, [])

  const update = useCallback((change: (previous: Settings) => Settings) => {
    if (!current.current) return
    const next = change(current.current)
    current.current = next
    setSettings(next)
    setError('')
    window.wu.invoke('settings:set', next).catch((cause: unknown) => {
      if (current.current === next) setError(`Impossible d’enregistrer les réglages (${String(cause)})`)
    })
  }, [])

  return { settings, ready, error, update }
}
