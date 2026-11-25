import { describe, expect, it } from 'vitest'
import { chunksForWrite } from './chunks'

describe('chunksForWrite', () => {
  it('laisse passer une saisie courte telle quelle', () => {
    expect(chunksForWrite('ls\r', 10)).toEqual(['ls\r'])
  })
  it('découpe un collage long en morceaux bornés, dans l’ordre', () => {
    const data = 'a'.repeat(25)
    const chunks = chunksForWrite(data, 10)
    expect(chunks.map((c) => c.length)).toEqual([10, 10, 5])
    expect(chunks.join('')).toBe(data)
  })
  it('ne coupe jamais un caractère hors BMP (paire de substitution) en deux', () => {
    const data = 'abcdefghi😀xyz' // l'emoji occupe les positions 9 et 10
    const chunks = chunksForWrite(data, 10)
    expect(chunks.join('')).toBe(data)
    expect(chunks.every((c) => !/[\uD800-\uDBFF]$/.test(c) && !/^[\uDC00-\uDFFF]/.test(c))).toBe(true)
  })
})
