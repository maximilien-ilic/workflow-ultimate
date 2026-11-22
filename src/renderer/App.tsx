import { useEffect, useState } from 'react'
import type { AppInfo } from '../shared/ipc'

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    void window.wu.invoke('app:info', {}).then(setInfo)
  }, [])
  return (
    <main>
      <h1>Workflow Ultimate</h1>
      <p>{info ? `v${info.version} · Electron ${info.electron} · Node ${info.node}` : 'Chargement…'}</p>
    </main>
  )
}
