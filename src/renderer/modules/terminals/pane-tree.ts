import type { PaneTree } from '../../../shared/terminal-history'
export { paneIds, type PaneTree } from '../../../shared/terminal-history'

export function splitPane(tree: PaneTree, target: string, dir: 'row' | 'column', id: string): PaneTree {
  if (tree.type === 'pane')
    return tree.id === target ? { type: 'split', dir, a: tree, b: { type: 'pane', id } } : tree
  const a = splitPane(tree.a, target, dir, id)
  const b = splitPane(tree.b, target, dir, id)
  return a === tree.a && b === tree.b ? tree : { ...tree, a, b }
}

// Renvoie null quand l'onglet n'a plus de volet.
export function closePane(tree: PaneTree, target: string): PaneTree | null {
  if (tree.type === 'pane') return tree.id === target ? null : tree
  const a = closePane(tree.a, target)
  const b = closePane(tree.b, target)
  if (a === tree.a && b === tree.b) return tree
  if (!a) return b
  if (!b) return a
  return { ...tree, a, b }
}
