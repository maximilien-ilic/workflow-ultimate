import { FitAddon } from '@xterm/addon-fit'
import { ImageAddon } from '@xterm/addon-image'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState } from 'react'
import { HISTORY_LINES } from '../../../shared/terminal-history'
import { terminalStore } from './terminal-store'
import { RESTORED_SEPARATOR, trackTerminalHistory } from './terminal-history'
import { chunksForWrite } from './chunks'
import { unseen } from './unseen'

type Props = {
  id: string
  cwd: string
  active: boolean
  focusRequest: number
  onFocus: () => void
}

const ack = (id: string, chars: number) => void window.wu.invoke('terminal:ack', { id, chars })

// Lecture seule du texte affiché, par id de volet (le rendu WebGL ne laisse aucun texte dans le DOM).
// Sert aux tests e2e et au débogage ; ne donne accès à rien que le renderer n'ait déjà.
const mounted = new Map<string, Terminal>()

// Un split remonte xterm alors qu'un collage peut encore attendre une réponse IPC.
const pendingInput = new Map<string, Promise<void>>()

function enqueueInput(id: string, data: string): void {
  const previous = pendingInput.get(id) ?? Promise.resolve()
  const writing = previous.then(async () => {
    for (const chunk of chunksForWrite(data)) {
      try {
        await window.wu.invoke('terminal:write', { id, data: chunk })
      } catch (error) {
        mounted.get(id)?.write(`\x1b[31m[saisie non transmise : ${String(error)}]\x1b[0m\r\n`)
      }
    }
  })
  pendingInput.set(id, writing)
  void writing.finally(() => {
    if (pendingInput.get(id) === writing) pendingInput.delete(id)
  })
}

// Dernières lignes non vides affichées par un terminal (aperçu de la vue d'ensemble des agents).
export function lastLines(id: string, count: number): string[] {
  const buffer = mounted.get(id)?.buffer.active
  if (!buffer) return []
  const lines: string[] = []
  for (let i = buffer.length - 1; i >= 0 && lines.length < count; i--) {
    const line = buffer.getLine(i)?.translateToString(true) ?? ''
    if (line.trim()) lines.unshift(line)
  }
  return lines
}
;(window as unknown as { __wuTerminalText: (id: string) => string }).__wuTerminalText = (id) => {
  const buffer = mounted.get(id)?.buffer.active
  if (!buffer) return ''
  const lines: string[] = []
  for (let i = 0; i < buffer.length; i++) lines.push(buffer.getLine(i)?.translateToString(true) ?? '')
  return lines.join('\n').trimEnd()
}

// Ctrl+clic ouvre le lien dans le navigateur du système (http/https seulement, vérifié par le main).
const openOnCtrlClick = (event: MouseEvent, url: string) => {
  if (event.ctrlKey) void window.wu.invoke('shell:openUrl', { url })
}

export function TerminalView({ id, cwd, active, focusRequest, onFocus }: Props) {
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
      scrollback: HISTORY_LINES,
      allowProposedApi: true, // requis par l'addon image (sixel)
      linkHandler: { activate: openOnCtrlClick }, // liens OSC 8 émis par les programmes
    })
    mounted.set(id, term)
    termRef.current = term
    const fit = new FitAddon()
    const search = new SearchAddon()
    searchRef.current = search
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(new ImageAddon())
    term.loadAddon(new WebLinksAddon(openOnCtrlClick)) // URL repérées dans le texte
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
      if (ctrlShift && ['KeyD', 'KeyE', 'KeyT', 'KeyW', 'KeyA', 'KeyJ', 'KeyG'].includes(e.code)) return false
      if (e.altKey && !e.ctrlKey && /^Digit[1-9]$/.test(e.code)) return false
      return true
    })

    // Frontière ordonnée rejeu / direct : l'écran contient le flux jusqu'à `cursor`. Tant que le rejeu
    // n'est pas arrivé, la sortie en direct attend dans `queue`, puis seule sa partie inédite est écrite.
    const history = terminalStore.history(id)
    let restoring = Boolean(history)
    let disposed = false
    let cursor = 0
    let ready = false
    let queue: { data: string; offset: number }[] = []
    // Écrit la partie inédite, puis acquitte le morceau entier une fois traité par xterm (contrôle de flux).
    const show = (data: string, offset: number, ackChars: number) => {
      const fresh = unseen(cursor, data, offset)
      cursor = Math.max(cursor, offset)
      term.write(fresh, () => ackChars && ack(id, ackChars))
    }
    let evicted = 0
    const flush = () => {
      for (const e of queue) show(e.data, e.offset, e.data.length)
      if (evicted) term.write('', () => ack(id, evicted))
      queue = []
      ready = true
    }

    const unsubscribe = window.wu.onTerminalEvent((event) => {
      if (event.type === 'host-restarted') {
        term.write('\r\n\x1b[33m[pty-host redémarré : ce terminal est perdu]\x1b[0m\r\n')
        return
      }
      if (event.id !== id) return
      if (event.type === 'data') {
        if (ready) show(event.data, event.offset, event.data.length)
        else {
          // Non acquittée, la file est déjà bornée par le contrôle de flux du main (pause du PTY) ;
          // cette borne-ci n'est qu'une sécurité.
          queue.push(event)
          // Un morceau écarté n'est jamais affiché : ses caractères sont acquittés au vidage de la file,
          // sinon le PTY resterait en pause.
          if (queue.length > 2000) evicted += queue.shift()?.data.length ?? 0
        }
      } else if (event.type === 'exit')
        term.write(`\r\n\x1b[2m[processus terminé, code ${event.exitCode}]\x1b[0m\r\n`)
      else term.write(`\r\n\x1b[31m[${event.message}]\x1b[0m\r\n`)
    })

    const input = term.onData((data) => enqueueInput(id, data))
    const resized = term.onResize(({ cols, rows }) => {
      if (!restoring) void window.wu.invoke('terminal:resize', { id, cols, rows })
    })
    const observer = new ResizeObserver(() => {
      if (!restoring) fit.fit()
    })
    observer.observe(el)
    const stopSaving = trackTerminalHistory(id, term, () => ready)

    const fail = (e: unknown) => term.write(`\x1b[31m[${String(e)}]\x1b[0m\r\n`)
    const connect = () => {
      if (terminalStore.isNew(id)) {
        // Marqué dès l'envoi pour qu'un remontage pendant le lancement se rattache.
        terminalStore.markStarted(id)
        flush()
        void window.wu
          .invoke('terminal:create', {
            id,
            cwd: history?.cwd ?? cwd,
            cols: term.cols,
            rows: term.rows,
          })
          .catch(fail)
        return
      }
      void window.wu.invoke('terminal:attach', { id }).then(
        (replay) => {
          if (disposed) return
          show(replay.data, replay.offset, 0) // le rejeu n'a jamais été compté comme non acquitté
          flush()
        },
        (e: unknown) => {
          if (disposed) return
          fail(e)
          flush() // sans rejeu : on affiche quand même ce qui arrive, sans le retenir indéfiniment
        },
      )
    }
    if (history) {
      // La sérialisation encode les retours à la ligne à la largeur d'origine.
      term.resize(history.cols, history.rows)
      term.write(history.data + RESTORED_SEPARATOR, () => {
        if (disposed) return
        fit.fit()
        restoring = false
        connect()
      })
    } else connect()

    return () => {
      disposed = true
      stopSaving()
      observer.disconnect()
      input.dispose()
      resized.dispose()
      unsubscribe()
      mounted.delete(id)
      term.dispose()
      termRef.current = null
    }
    // Le terminal est créé une seule fois par volet : id et cwd ne changent pas pour un même volet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (active) termRef.current?.focus()
  }, [active, focusRequest])

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
