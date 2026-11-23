import { describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { validated, isTrustedSender, IpcValidationError, IpcForbiddenError } from './ipc'

const FILE_RENDERER = 'file:///opt/wu/out/renderer/index.html'
const DEV_RENDERER = 'http://localhost:5173/'

const eventFrom = (url: string, isMainFrame = true) =>
  ({ senderFrame: { url, parent: isMainFrame ? null : {} } }) as unknown as IpcMainInvokeEvent
const trustAll = () => true

describe('validated', () => {
  it('passe la requête validée au handler et renvoie sa réponse', async () => {
    const fn = vi.fn(() => ({ name: 'wu', version: '0.0.0', electron: '45', node: '24' }))
    await expect(validated('app:info', fn, trustAll)(eventFrom(FILE_RENDERER), {})).resolves.toEqual(
      expect.objectContaining({ name: 'wu' }),
    )
    expect(fn).toHaveBeenCalledWith({})
  })

  it.each([
    ['clé inconnue', { extra: 1 }],
    ['undefined', undefined],
    ['mauvais type', 'app'],
  ])('rejette une requête invalide (%s) sans appeler le handler', async (_label, raw) => {
    const fn = vi.fn()
    const call = validated('app:info', fn, trustAll)(eventFrom(FILE_RENDERER), raw)
    await expect(call).rejects.toBeInstanceOf(IpcValidationError)
    await expect(call).rejects.toThrow(/app:info/)
    expect(fn).not.toHaveBeenCalled()
  })

  it("rejette un émetteur non fiable avant même de lire la requête", async () => {
    const fn = vi.fn()
    const call = validated('app:info', fn, () => false)(eventFrom('https://evil.example/'), {})
    await expect(call).rejects.toBeInstanceOf(IpcForbiddenError)
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('isTrustedSender', () => {
  it.each([
    ['le renderer local (file)', FILE_RENDERER, FILE_RENDERER, true],
    ['le renderer local avec un hash', `${FILE_RENDERER}#/projets`, FILE_RENDERER, true],
    ['un autre fichier local', 'file:///tmp/evil.html', FILE_RENDERER, false],
    ['une page web', 'https://evil.example/', FILE_RENDERER, false],
    ['le serveur de dev', 'http://localhost:5173/src/x', DEV_RENDERER, true],
    ['un autre port en dev', 'http://localhost:6666/', DEV_RENDERER, false],
  ])('%s', (_label, senderUrl, rendererUrl, expected) => {
    expect(isTrustedSender(eventFrom(senderUrl), rendererUrl)).toBe(expected)
  })

  it("refuse une iframe, même à la bonne adresse", () => {
    expect(isTrustedSender(eventFrom(FILE_RENDERER, false), FILE_RENDERER)).toBe(false)
  })

  it("refuse un événement sans frame (frame détruite)", () => {
    expect(isTrustedSender({ senderFrame: null } as unknown as IpcMainInvokeEvent, FILE_RENDERER)).toBe(false)
  })
})
