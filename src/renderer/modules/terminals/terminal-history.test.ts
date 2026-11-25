import type { Terminal } from '@xterm/xterm'
import { afterEach, expect, it, vi } from 'vitest'
import { HISTORY_CHARACTERS, HISTORY_LINES } from '../../../shared/terminal-history'
import { startTerminalHistory, trackTerminalHistory } from './terminal-history'

const serialize = vi.hoisted(() => vi.fn())
vi.mock('@xterm/addon-serialize', () => ({
  SerializeAddon: class {
    serialize = serialize
  },
}))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  serialize.mockReset()
})

function setup() {
  vi.useFakeTimers()
  const invoke = vi.fn().mockResolvedValue(null)
  const onTerminalHistoryFlush = vi.fn<(listener: () => void) => void>()
  vi.stubGlobal('window', { wu: { invoke, onTerminalHistoryFlush }, setInterval, clearInterval })
  const term = {
    buffer: { normal: { length: HISTORY_LINES + 24 } },
    cols: 80,
    rows: 24,
    loadAddon: vi.fn(),
    onWriteParsed: () => ({ dispose: vi.fn() }),
    write: vi.fn<(data: string, callback: () => void) => void>(),
  }
  startTerminalHistory()
  const stop = trackTerminalHistory('volet', term as unknown as Terminal, () => true)
  const flush = onTerminalHistoryFlush.mock.lastCall![0]
  return { invoke, term, stop, flush }
}

it('réduit la plage par le début quand la sérialisation dépasse la limite', async () => {
  const { invoke, stop } = setup()
  try {
    serialize.mockReturnValueOnce('x'.repeat(HISTORY_CHARACTERS + 1)).mockReturnValueOnce('historique récent')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(serialize.mock.calls.map(([options]) => options.range)).toEqual([
      { start: 24, end: HISTORY_LINES + 23 },
      { start: 24 + HISTORY_LINES / 2, end: HISTORY_LINES + 23 },
    ])
    expect(invoke).toHaveBeenCalledExactlyOnceWith('terminal:saveHistory', {
      id: 'volet',
      data: 'historique récent',
      rows: 24,
      cols: 80,
    })
  } finally {
    stop()
  }
})

it('attend le traitement de la sortie et la sauvegarde avant de confirmer la fermeture', async () => {
  const { invoke, term, stop, flush } = setup()
  let confirmSave: () => void = () => {}
  const saved = new Promise<void>((resolve) => {
    confirmSave = resolve
  })
  try {
    serialize.mockReturnValue('dernière sortie')
    invoke.mockReturnValueOnce(saved)
    flush()
    expect(invoke).not.toHaveBeenCalled()

    term.write.mock.lastCall![1]()
    await vi.advanceTimersByTimeAsync(0)
    expect(invoke).toHaveBeenCalledExactlyOnceWith('terminal:saveHistory', {
      id: 'volet',
      data: 'dernière sortie',
      rows: 24,
      cols: 80,
    })
    confirmSave()
    await vi.advanceTimersByTimeAsync(0)
    expect(invoke).toHaveBeenLastCalledWith('terminal:historyFlushed', {})
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    stop()
  }
})
