import { describe, expect, it } from 'vitest'
import { closePane, paneIds, splitPane, type PaneTree } from './pane-tree'

const leaf = (id: string): PaneTree => ({ type: 'pane', id })

describe('pane-tree', () => {
  it('découpe un volet en deux, le nouveau à droite ou en bas', () => {
    expect(splitPane(leaf('a'), 'a', 'row', 'b')).toEqual({
      type: 'split',
      dir: 'row',
      a: leaf('a'),
      b: leaf('b'),
    })
  })

  it('découpe un volet au fond de l’arbre sans toucher aux autres', () => {
    const tree = splitPane(splitPane(leaf('a'), 'a', 'row', 'b'), 'b', 'column', 'c')
    expect(paneIds(tree)).toEqual(['a', 'b', 'c'])
    expect(tree).toEqual({
      type: 'split',
      dir: 'row',
      a: leaf('a'),
      b: { type: 'split', dir: 'column', a: leaf('b'), b: leaf('c') },
    })
  })

  it('fermer un volet laisse la place à son voisin', () => {
    const tree = splitPane(splitPane(leaf('a'), 'a', 'row', 'b'), 'b', 'column', 'c')
    expect(closePane(tree, 'b')).toEqual({ type: 'split', dir: 'row', a: leaf('a'), b: leaf('c') })
    expect(closePane(closePane(tree, 'b')!, 'a')).toEqual(leaf('c'))
  })

  it('fermer le dernier volet vide l’onglet', () => {
    expect(closePane(leaf('a'), 'a')).toBeNull()
  })

  it('un id inconnu ne change rien', () => {
    const tree = splitPane(leaf('a'), 'a', 'row', 'b')
    expect(splitPane(tree, 'x', 'row', 'y')).toBe(tree)
    expect(closePane(tree, 'x')).toBe(tree)
  })
})
