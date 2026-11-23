import { describe, expect, it } from 'vitest'
import { nextWaiting, sortForOverview } from './overview'

const a = (id: string, state: string, startedAt = 0) => [id, { state, startedAt }] as const

describe('sortForOverview', () => {
  it("met en tête ce qui demande l'attention : attente, erreur, travail, démarrage, terminé", () => {
    const sorted = sortForOverview([
      a('d', 'done'),
      a('w', 'working'),
      a('x', 'error'),
      a('q', 'waiting'),
      a('s', 'starting'),
    ])
    expect(sorted.map(([id]) => id)).toEqual(['q', 'x', 'w', 's', 'd'])
  })
  it('à état égal, le plus récent d’abord', () => {
    expect(sortForOverview([a('vieux', 'waiting', 1), a('neuf', 'waiting', 2)]).map(([id]) => id)).toEqual([
      'neuf',
      'vieux',
    ])
  })
})

describe('nextWaiting', () => {
  const agents = [a('1', 'waiting'), a('2', 'working'), a('3', 'waiting')]
  it('va au prochain agent en attente après le courant, en boucle', () => {
    expect(nextWaiting(agents, '1')).toBe('3')
    expect(nextWaiting(agents, '3')).toBe('1')
    expect(nextWaiting(agents, '2')).toBe('3')
  })
  it('sans agent en attente : rien', () => {
    expect(nextWaiting([a('2', 'working')], '2')).toBeNull()
  })
})
