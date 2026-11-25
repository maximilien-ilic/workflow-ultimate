import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostEvent, HostRequest } from '../../../shared/pty-protocol'

// Banc de test du pont : faux ipcMain qui capture les handlers, faux pty-host piloté à la main.
const handlers = new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: never) => handlers.set(channel, fn) },
  app: { isPackaged: true },
  BrowserWindow: class {},
}))
const { registerTerminalHandlers } = await import('./ipc')
const { rendererUrl } = await import('../shell/window')

const sender = { send: vi.fn(), isDestroyed: () => false }
const event = { sender, senderFrame: { url: rendererUrl(), parent: null } }
const call = (channel: string, req: unknown) => handlers.get(channel)!(event, req)

function setup() {
  const sent: HostRequest[] = []
  const host = {
    send: (req: HostRequest) => void sent.push(req),
    events: new EventEmitter(),
    stop: () => {},
  }
  const terminals = registerTerminalHandlers(host as never)
  const emit = (e: HostEvent) => host.events.emit('event', e)
  return { sent, host, terminals, emit }
}

const id = '3b241101-e2bb-4255-8caf-4136c566a962'
const create = () => call('terminal:create', { id, cwd: '/tmp', cols: 80, rows: 24 })
const overflowingData = 'x'.repeat(100_001)
const overflowingEvent = { type: 'data', id, data: overflowingData, offset: overflowingData.length } as const

beforeEach(() => {
  handlers.clear()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('pont des terminaux', () => {
  it("après un délai dépassé, l'id reste réservé jusqu'à la fermeture confirmée", async () => {
    const { sent, emit } = setup()
    const first = expect(create()).rejects.toThrow(/délai dépassé/) // attaché avant le rejet
    emit(overflowingEvent)
    expect(sent.at(-1)).toEqual({ type: 'pause', id })
    await vi.advanceTimersByTimeAsync(5001)
    await first
    expect(sent.at(-1)).toEqual({ type: 'kill', id })

    // Relancer tout de suite le même id : refusé, sinon la confirmation tardive du premier le validerait.
    await expect(create()).rejects.toThrow(/fermeture/)
    emit({ type: 'spawned', id, pid: 1 }) // confirmation tardive du premier lancement : ignorée
    emit({ type: 'closed', id })

    const second = create()
    expect(sent.at(-1)).toMatchObject({ type: 'spawn', id })
    emit({ type: 'spawned', id, pid: 2 })
    await expect(second).resolves.toEqual({ pid: 2 })
    emit(overflowingEvent)
    expect(sent.at(-1)).toEqual({ type: 'pause', id })
  })

  it("un lancement refusé par le pty-host libère l'id tout de suite", async () => {
    const { sent, emit } = setup()
    const first = create()
    emit({ type: 'error', id, request: 'spawn', message: 'Dossier introuvable' })
    await expect(first).rejects.toThrow('Dossier introuvable')
    expect(sent.filter((r) => r.type === 'kill')).toEqual([]) // rien à fermer
    void create()
    expect(sent.at(-1)).toMatchObject({ type: 'spawn', id })
  })

  it('un redémarrage du pty-host perd les terminaux : attentes rejetées, fenêtre et agents prévenus', async () => {
    const { host, terminals, emit, sent } = setup()
    const exits: [string, number][] = []
    terminals.onExit((tid, code) => exits.push([tid, code]))
    const running = create()
    emit({ type: 'spawned', id, pid: 1 })
    await running
    emit(overflowingEvent)
    expect(sent.at(-1)).toEqual({ type: 'pause', id })
    const other = '9c858901-8a57-4791-81fe-4c455b099bc9'
    const pending = expect(
      call('terminal:create', { id: other, cwd: '/tmp', cols: 80, rows: 24 }),
    ).rejects.toThrow(/redémarré/)
    await vi.advanceTimersByTimeAsync(0)
    sender.send.mockClear()

    host.events.emit('restarted')
    await pending
    expect(sender.send).toHaveBeenCalledWith('terminal:event', { type: 'host-restarted' })
    expect(exits).toEqual([[id, -1]]) // les agents de ce terminal passent en erreur et peuvent être repris

    // Un hôte neuf fonctionne : on peut relancer.
    const again = create()
    await vi.advanceTimersByTimeAsync(0)
    emit({ type: 'spawned', id, pid: 2 })
    await expect(again).resolves.toEqual({ pid: 2 })
    emit(overflowingEvent)
    expect(sent.at(-1)).toEqual({ type: 'pause', id })
  })

  it('après abandon du pty-host, tout lancement échoue tout de suite', async () => {
    const { host } = setup()
    host.events.emit('gaveUp')
    await expect(create()).rejects.toThrow(/indisponible/)
  })
})
