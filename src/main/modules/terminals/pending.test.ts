import { afterEach, describe, expect, it, vi } from 'vitest'
import { Pending } from './pending'

afterEach(() => vi.useRealTimers())

describe('Pending', () => {
  it('résout toutes les attentes d’un même id', async () => {
    const pending = new Pending<string>()
    const a = pending.wait('t', 1000)
    const b = pending.wait('t', 1000)
    pending.settle('t', 'ok')
    await expect(Promise.all([a, b])).resolves.toEqual(['ok', 'ok'])
  })

  it('rejette sur erreur, sur délai dépassé, et toutes d’un coup', async () => {
    vi.useFakeTimers()
    const pending = new Pending<string>()
    const failed = pending.wait('a', 1000)
    pending.fail('a', new Error('refusé'))
    await expect(failed).rejects.toThrow('refusé')

    const late = pending.wait('b', 1000)
    vi.advanceTimersByTime(1001)
    await expect(late).rejects.toThrow(/délai/)

    const lost = pending.wait('c', 1000)
    pending.failAll(new Error('pty-host redémarré'))
    await expect(lost).rejects.toThrow('redémarré')
  })

  it('ignore un règlement sans attente', () => {
    expect(() => new Pending<string>().settle('x', 'y')).not.toThrow()
  })
})
