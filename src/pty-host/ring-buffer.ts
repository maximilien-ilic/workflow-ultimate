// Garde les `capacity` derniers caractères de sortie d'un terminal, pour les rejouer à une reconnexion.
export class RingBuffer {
  private chunks: string[] = []
  private size = 0

  constructor(private readonly capacity: number) {}

  push(chunk: string): void {
    this.chunks.push(chunk)
    this.size += chunk.length
    while (this.size > this.capacity) {
      const first = this.chunks[0] ?? ''
      const excess = this.size - this.capacity
      if (first.length <= excess) {
        this.chunks.shift()
        this.size -= first.length
      } else {
        this.chunks[0] = first.slice(excess)
        this.size -= excess
      }
    }
  }

  read(): string {
    return this.chunks.join('')
  }
}
