import { describe, expect, it, vi } from 'vitest'
import { validated, IpcValidationError } from './ipc'

const event = {} as Electron.IpcMainInvokeEvent

describe('validated', () => {
  it('passe la requête validée au handler et renvoie sa réponse', async () => {
    const fn = vi.fn(() => ({ name: 'wu', version: '0.0.0', electron: '45', node: '24' }))
    await expect(validated('app:info', fn)(event, {})).resolves.toEqual(
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
    const call = validated('app:info', fn)(event, raw)
    await expect(call).rejects.toBeInstanceOf(IpcValidationError)
    await expect(call).rejects.toThrow(/app:info/)
    expect(fn).not.toHaveBeenCalled()
  })
})
