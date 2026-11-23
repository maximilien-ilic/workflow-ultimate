// Disposition des terminaux d'un onglet : un arbre binaire de splits.
export type PaneTree =
  { type: 'pane'; id: string } | { type: 'split'; dir: 'row' | 'column'; a: PaneTree; b: PaneTree }

export function paneIds(tree: PaneTree): string[] {
  return tree.type === 'pane' ? [tree.id] : [...paneIds(tree.a), ...paneIds(tree.b)]
}

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
