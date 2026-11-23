import { FitAddon } from '@xterm/addon-fit'
import { ImageAddon } from '@xterm/addon-image'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState } from 'react'

type Props = {
  id: string
  cwd: string
  // false : le PTY existe déjà (après un rechargement du renderer), on rejoue sa sortie au lieu de le créer.
  isNew: boolean
  active: boolean
  onFocus: () => void
}

const ack = (id: string, chars: number) => void window.wu.invoke('terminal:ack', { id, chars })

export function TerminalView({ id, cwd, isNew, active, onFocus }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const el = container.current
    if (!el) return
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "Noto Sans Mono", monospace',
      fontSize: 13,
      scrollback: 10_000,
      allowProposedApi: true, // requis par l'addon image (sixel)
    })
    termRef.current = term
    const fit = new FitAddon()
    const search = new SearchAddon()
    searchRef.current = search
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(new ImageAddon())
    // Ctrl+clic ouvre le lien dans le navigateur du système (http/https seulement, vérifié par le main).
    term.loadAddon(
      new WebLinksAddon((event, url) => {
        if (event.ctrlKey) void window.wu.invoke('shell:openUrl', { url })
      }),
    )
    term.open(el)
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose()) // repli automatique sur le rendu DOM
      term.loadAddon(webgl)
    } catch {
      // Pas de WebGL (GPU absent, pilote bloqué) : xterm garde son rendu DOM.
    }
    fit.fit()

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const ctrlShift = e.ctrlKey && e.shiftKey && !e.altKey
      if (ctrlShift && e.code === 'KeyC') {
        if (term.hasSelection()) void navigator.clipboard.writeText(term.getSelection())
        return false
      }
      if (ctrlShift && e.code === 'KeyV') {
        void navigator.clipboard.readText().then((text) => term.paste(text))
        return false
      }
      if (ctrlShift && e.code === 'KeyF') {
        setSearching(true)
        return false
      }
      if (e.ctrlKey && !e.shiftKey && (e.key === '=' || e.key === '+' || e.key === '-')) {
        const size = (term.options.fontSize ?? 13) + (e.key === '-' ? -1 : 1)
        term.options.fontSize = Math.min(32, Math.max(8, size))
        fit.fit()
        return false
      }
      // Raccourcis de la zone de terminaux (onglets, splits) : laissés à la fenêtre.
      if (ctrlShift && ['KeyD', 'KeyE', 'KeyT', 'KeyW'].includes(e.code)) return false
      if (e.altKey && !e.ctrlKey && /^Digit[1-9]$/.test(e.code)) return false
      return true
    })

    const unsubscribe = window.wu.onTerminalEvent((event) => {
      if (event.type === 'host-restarted') {
        term.write('\r\n\x1b[33m[pty-host redémarré : ce terminal est perdu]\x1b[0m\r\n')
        return
      }
      if (event.id !== id) return
      if (event.type === 'data') term.write(event.data, () => ack(id, event.data.length))
      else if (event.type === 'exit')
        term.write(`\r\n\x1b[2m[processus terminé, code ${event.exitCode}]\x1b[0m\r\n`)
      else term.write(`\r\n\x1b[31m[${event.message}]\x1b[0m\r\n`)
    })

    const input = term.onData((data) => void window.wu.invoke('terminal:write', { id, data }))
    const resized = term.onResize(
      ({ cols, rows }) => void window.wu.invoke('terminal:resize', { id, cols, rows }),
    )
    const observer = new ResizeObserver(() => fit.fit())
    observer.observe(el)

    if (isNew) void window.wu.invoke('terminal:create', { id, cwd, cols: term.cols, rows: term.rows })
    else
      void window.wu.invoke('terminal:attach', { id }).then(
        (replay) => term.write(replay),
        (e: unknown) => term.write(`\x1b[31m[${String(e)}]\x1b[0m\r\n`),
      )

    return () => {
      observer.disconnect()
      input.dispose()
      resized.dispose()
      unsubscribe()
      term.dispose()
      termRef.current = null
    }
    // Le terminal est créé une seule fois par volet : id et cwd ne changent pas pour un même volet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (active) termRef.current?.focus()
  }, [active])

  return (
    <div className="terminal-pane" data-active={active} onFocus={onFocus} onMouseDown={onFocus}>
      {searching && (
        <input
          className="terminal-search"
          aria-label="Rechercher dans le terminal"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSearching(false)
              termRef.current?.focus()
            } else if (e.key === 'Enter') {
              const value = e.currentTarget.value
              if (e.shiftKey) searchRef.current?.findPrevious(value)
              else searchRef.current?.findNext(value)
            }
          }}
        />
      )}
      <div ref={container} className="terminal-host" data-terminal-id={id} />
    </div>
  )
}
