import { describe, expect, it } from 'vitest'
import { RingBuffer } from './ring-buffer'

describe('RingBuffer', () => {
  it('rend tout ce qui tient dans la capacité', () => {
    const buf = new RingBuffer(10)
    buf.push('abc')
    buf.push('def')
    expect(buf.read()).toBe('abcdef')
  })

  it('oublie le plus ancien au-delà de la capacité, même au milieu d’un morceau', () => {
    const buf = new RingBuffer(5)
    buf.push('abcd')
    buf.push('efgh')
    expect(buf.read()).toBe('defgh')
  })

  it('accepte un morceau plus gros que la capacité', () => {
    const buf = new RingBuffer(3)
    buf.push('0123456789')
    expect(buf.read()).toBe('789')
  })
})
