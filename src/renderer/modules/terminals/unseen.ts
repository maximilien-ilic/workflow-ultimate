// Partie d'un morceau de sortie pas encore affichée, sachant que l'écran contient le flux jusqu'à `cursor`
// (le rejeu s'arrête à un offset ; la sortie en direct reçue pendant ce temps peut le chevaucher).
export function unseen(cursor: number, data: string, offset: number): string {
  if (offset <= cursor) return ''
  return data.slice(Math.max(0, cursor - (offset - data.length)))
}
