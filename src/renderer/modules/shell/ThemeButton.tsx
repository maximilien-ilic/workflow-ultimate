import { useCallback, useEffect, useState } from 'react'
import { readTheme, setTheme } from './app-theme'
import { Button } from './design-primitives'
import { registerCommand } from '../palette/commands'

export function ThemeButton() {
  const [light, setLight] = useState(() => readTheme() === 'light')
  const change = useCallback(() => {
    setTheme(light ? 'dark' : 'light')
    setLight(!light)
  }, [light])
  useEffect(() => registerCommand({
    id: 'shell.toggle-theme',
    title: light ? 'Passer au thème sombre' : 'Passer au thème clair',
    run: change,
  }), [change, light])
  return <Button aria-pressed={light} onClick={change}>Thème clair</Button>
}
