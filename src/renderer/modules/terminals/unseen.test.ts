import { describe, expect, it } from 'vitest'
import { unseen } from './unseen'

// L'écran contient le flux jusqu'à `cursor` ; un morceau couvre ]offset - longueur, offset].
describe('unseen', () => {
  it('écrit tout un morceau qui commence après le curseur', () => {
    expect(unseen(10, 'abc', 13)).toBe('abc')
  })
  it('ignore un morceau déjà contenu dans le rejeu', () => {
    expect(unseen(10, 'abc', 8)).toBe('')
    expect(unseen(10, 'abc', 10)).toBe('')
  })
  it("n'écrit que la fin d'un morceau à cheval sur le rejeu", () => {
    expect(unseen(10, 'abcdef', 14)).toBe('cdef') // positions 9 à 14, « ab » déjà à l'écran
  })
})
