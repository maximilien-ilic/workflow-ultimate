export const HISTORY_LINES = 10_000
export const HISTORY_CHARACTERS = 4 * 1024 * 1024

export type PaneTree =
  { type: 'pane'; id: string } | { type: 'split'; dir: 'row' | 'column'; a: PaneTree; b: PaneTree }

export function paneIds(tree: PaneTree): string[] {
  return tree.type === 'pane' ? [tree.id] : [...paneIds(tree.a), ...paneIds(tree.b)]
}
