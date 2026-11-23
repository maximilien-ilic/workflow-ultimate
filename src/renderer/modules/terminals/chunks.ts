// Le canal terminal:write borne chaque écriture (64 Kio) : une saisie plus longue (collage) est découpée
// en morceaux envoyés dans l'ordre, sans jamais séparer les deux moitiés d'un caractère hors BMP.
export function chunksForWrite(data: string, max = 60_000): string[] {
  const chunks: string[] = []
  for (let start = 0; start < data.length; ) {
    let end = Math.min(start + max, data.length)
    const last = data.charCodeAt(end - 1)
    if (end < data.length && last >= 0xd800 && last <= 0xdbff) end-- // demi-caractère : au morceau suivant
    chunks.push(data.slice(start, end))
    start = end
  }
  return chunks
}
