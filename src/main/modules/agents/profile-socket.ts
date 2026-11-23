import { createHash } from 'node:crypto'
import { app } from 'electron'
import { agentSocketPath } from './socket'

// Un socket par profil (userData) : une version de dev, l'appli installée et les tests e2e parallèles
// ne se disputent pas le même socket. Partagé par le démarrage et la page Diagnostic.
export async function profileSocketPath(): Promise<string> {
  const profile = createHash('sha256').update(app.getPath('userData')).digest('hex').slice(0, 8)
  return (await agentSocketPath()).replace(/\.sock$/, `-${profile}.sock`)
}
