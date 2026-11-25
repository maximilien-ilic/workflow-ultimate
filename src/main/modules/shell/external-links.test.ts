import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>()
const openExternal = vi.fn()
const showMessageBox = vi.fn()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: never) => handlers.set(channel, fn) },
  app: { isPackaged: true },
  BrowserWindow: class {
    static fromWebContents = () => null
  },
  shell: { openExternal: (url: string) => openExternal(url) },
  dialog: { showMessageBox: (...args: unknown[]) => showMessageBox(...args) },
}))
const { registerExternalLinks } = await import('./external-links')
const { rendererUrl } = await import('./window')

const event = { sender: {}, senderFrame: { url: rendererUrl(), parent: null } }
const open = (url: string, from: unknown = event) => handlers.get('shell:openUrl')!(from, { url })

beforeEach(() => {
  handlers.clear()
  openExternal.mockReset()
  showMessageBox.mockReset()
  registerExternalLinks(['https://github.com'])
})

describe('liens externes des terminaux', () => {
  it("ouvre directement une origine de la liste d'autorisation", async () => {
    await open('https://github.com/maximilien-ilic/workflow-ultimate/pull/91')
    expect(showMessageBox).not.toHaveBeenCalled()
    expect(openExternal).toHaveBeenCalledWith('https://github.com/maximilien-ilic/workflow-ultimate/pull/91')
  })

  it('refuse par défaut tout autre lien, sauf confirmation explicite', async () => {
    showMessageBox.mockResolvedValueOnce({ response: 1 }) // Annuler
    await open('https://evil.example/piege')
    expect(openExternal).not.toHaveBeenCalled()

    showMessageBox.mockResolvedValueOnce({ response: 0 }) // Ouvrir
    await open('https://docs.example/page')
    expect(openExternal).toHaveBeenCalledWith('https://docs.example/page')
    expect(showMessageBox.mock.calls.at(-1)?.at(-1)).toMatchObject({ detail: 'https://docs.example/page' })
  })

  it("une origine voisine n'est pas confondue avec une origine autorisée", async () => {
    showMessageBox.mockResolvedValueOnce({ response: 1 })
    await open('https://github.com.evil.example/x')
    expect(showMessageBox).toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('garde le contrôle du frame appelant', async () => {
    const iframe = { sender: {}, senderFrame: { url: rendererUrl(), parent: {} } }
    await expect(open('https://github.com/x', iframe)).rejects.toThrow(/non autorisé/)
    expect(openExternal).not.toHaveBeenCalled()
  })
})
