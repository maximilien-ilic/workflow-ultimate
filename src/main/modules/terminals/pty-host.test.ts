import { describe, expect, it } from 'vitest'
import { shouldRestart } from './pty-host'

describe('shouldRestart', () => {
  it('redémarre tant qu’il y a moins de 5 arrêts dans la dernière minute', () => {
    expect(shouldRestart([], 100_000)).toBe(true)
    expect(shouldRestart([1, 2, 3, 4].map((s) => 100_000 - s * 1000), 100_000)).toBe(true)
  })
  it('abandonne au-delà de 5 arrêts en une minute', () => {
    expect(shouldRestart([1, 2, 3, 4, 5].map((s) => 100_000 - s * 1000), 100_000)).toBe(false)
  })
  it('oublie les arrêts de plus d’une minute', () => {
    expect(shouldRestart([1, 2, 3, 4, 5].map((s) => 100_000 - 61_000 - s), 100_000)).toBe(true)
  })
})
