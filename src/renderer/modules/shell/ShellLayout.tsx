import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { panelCommandBindings } from '../../../shared/keybindings'
import { maxPanelWidth, minPanelWidth } from '../../../shared/layout-defaults'
import type { Settings } from '../../../shared/settings'
import { CommandPalette } from '../palette/CommandPalette'
import { registerCommand } from '../palette/commands'
import { useSettings } from './use-settings'
import './layout.css'

type Side = keyof Settings['layout']
const panelNames = { left: 'Barre latérale', right: 'Contexte' }
const panelIds = { left: 'shell-left', right: 'shell-right' }
const clampWidth = (width: number) => Math.min(maxPanelWidth, Math.max(minPanelWidth, Math.round(width)))

function Panel({
  side,
  panel,
  enabled,
  onResize,
  children,
}: {
  side: Side
  panel: Settings['layout'][Side]
  enabled: boolean
  onResize: (width: number) => void
  children?: ReactNode
}) {
  const drag = useRef<AbortController | null>(null)
  const [draft, setDraft] = useState<number | null>(null)
  const direction = side === 'left' ? 1 : -1
  const width = draft ?? panel.width
  useEffect(() => () => drag.current?.abort(), [])

  return (
    <>
      <aside
        className={`shell-panel shell-panel-${side}`}
        id={panelIds[side]}
        aria-label={panelNames[side]}
        style={{ width: `min(${width}px, 36%)` }}
      >
        {children}
      </aside>
      <div
        className={`shell-separator shell-separator-${side}`}
        tabIndex={enabled ? 0 : -1}
        role="separator"
        aria-label={panelNames[side]}
        aria-orientation="vertical"
        aria-controls={panelIds[side]}
        aria-valuemin={minPanelWidth}
        aria-valuemax={maxPanelWidth}
        aria-valuenow={width}
        onKeyDown={(event) => {
          const delta = event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0
          if (!enabled || !delta) return
          event.preventDefault()
          onResize(clampWidth(width + delta * direction))
        }}
        onPointerDown={(event) => {
          if (!enabled || event.button !== 0 || !event.isPrimary) return
          event.preventDefault()
          event.currentTarget.focus({ preventScroll: true })
          drag.current?.abort()
          const controller = new AbortController()
          drag.current = controller
          const options = { signal: controller.signal }
          const { pointerId, clientX } = event
          const resized = (x: number) => clampWidth(width + (x - clientX) * direction)
          const end = () => {
            controller.abort()
            drag.current = null
            setDraft(null)
          }

          // Le pointeur peut rester dans la fenêtre après la perte de capture.
          window.addEventListener(
            'pointermove',
            (move) => {
              if (move.pointerId === pointerId && move.buttons & 1) setDraft(resized(move.clientX))
            },
            options,
          )
          window.addEventListener(
            'pointerup',
            (up) => {
              if (up.pointerId !== pointerId || up.button !== 0) return
              end()
              onResize(resized(up.clientX))
            },
            options,
          )
          window.addEventListener(
            'pointercancel',
            (cancel) => {
              if (cancel.pointerId === pointerId) end()
            },
            options,
          )
          window.addEventListener('blur', end, options)
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
      />
    </>
  )
}

export function ShellLayout({
  children,
  leftPanel,
  rightPanel,
}: {
  children: ReactNode
  leftPanel?: ReactNode
  rightPanel?: ReactNode
}) {
  const { settings, ready, error, update } = useSettings()
  const toggle = useCallback(
    (side: Side) => {
      update((previous) => ({
        ...previous,
        layout: {
          ...previous.layout,
          [side]: { ...previous.layout[side], visible: !previous.layout[side].visible },
        },
      }))
    },
    [update],
  )

  useEffect(() => {
    const removeLeft = registerCommand({
      id: 'shell.toggle-left',
      title: 'Basculer la barre latérale',
      keybinding: panelCommandBindings['shell.toggle-left'],
      run: () => toggle('left'),
    })
    const removeRight = registerCommand({
      id: 'shell.toggle-right',
      title: 'Basculer le panneau de contexte',
      keybinding: panelCommandBindings['shell.toggle-right'],
      run: () => toggle('right'),
    })
    return () => {
      removeLeft()
      removeRight()
    }
  }, [toggle])

  const { layout } = settings
  const panel = (side: Side, contents: ReactNode) => (
    <Panel
      side={side}
      panel={layout[side]}
      enabled={ready}
      onResize={(width) =>
        update((previous) => ({
          ...previous,
          layout: { ...previous.layout, [side]: { ...previous.layout[side], width } },
        }))
      }
    >
      {contents}
    </Panel>
  )

  return (
    <div className="shell">
      <div className="shell-controls">
        {(['left', 'right'] as const).map((side) => (
          <button
            key={side}
            type="button"
            disabled={!ready}
            aria-pressed={layout[side].visible}
            onClick={() => toggle(side)}
          >
            {panelNames[side]}
          </button>
        ))}
        <CommandPalette
          enabled={ready}
          keybindings={settings.keybindings}
          onKeybindingChange={(id, keybinding) =>
            update((previous) => ({
              ...previous,
              keybindings: { ...previous.keybindings, [id]: keybinding },
            }))
          }
        />
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="shell-panes">
        {layout.left.visible && panel('left', leftPanel)}
        <div className="shell-center">{children}</div>
        {layout.right.visible && panel('right', rightPanel)}
      </div>
    </div>
  )
}
