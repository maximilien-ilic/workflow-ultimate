import { useEffect, useId, useRef, useState } from 'react'
import { registerCommand } from '../palette/commands'

export function Diagnostics() {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  const [report, setReport] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let request = 0
    const unregister = registerCommand({
      id: 'shell.diagnostics',
      title: 'Diagnostic',
      run() {
        const element = dialog.current
        if (!element || element.open) return
        const id = ++request
        setReport('')
        setError('')
        setCopied(false)
        setLoading(true)
        element.showModal()
        void window.wu.invoke('diagnostics:report', {}).then(
          (text) => {
            if (id !== request) return
            setReport(text)
            setLoading(false)
          },
          () => {
            if (id !== request) return
            setError('Impossible de charger le rapport.')
            setLoading(false)
          },
        )
      },
    })
    return () => {
      request++
      unregister()
    }
  }, [])

  async function copy() {
    setError('')
    setCopied(false)
    try {
      await navigator.clipboard.writeText(report)
      setCopied(true)
    } catch {
      setError('Impossible de copier le rapport.')
    }
  }

  return (
    <dialog ref={dialog} aria-labelledby={title} style={{ maxWidth: 'min(42rem, 90vw)' }}>
      <h2 id={title}>Diagnostic</h2>
      {report && (
        <pre aria-label="Rapport de diagnostic" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {report}
        </pre>
      )}
      <p role="status">{loading ? 'Chargement du rapport…' : copied ? 'Rapport copié.' : ''}</p>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={() => dialog.current?.close()}>
        Fermer
      </button>{' '}
      <button type="button" onClick={() => void copy()} disabled={!report}>
        Copier le rapport
      </button>
    </dialog>
  )
}
