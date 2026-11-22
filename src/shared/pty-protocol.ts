// Protocole main ↔ pty-host. Le pty-host est un processus interne de confiance :
// la validation des requêtes venant du renderer se fait dans le main, avant d'arriver ici.
export type HostRequest =
  | {
      type: 'spawn'
      id: string
      file: string
      args: string[]
      cwd: string
      env: Record<string, string>
      cols: number
      rows: number
    }
  | { type: 'write'; id: string; data: string }
  | { type: 'resize'; id: string; cols: number; rows: number }
  // Sur un terminal en cours : le termine. Sur un terminal déjà terminé : libère son tampon.
  | { type: 'kill'; id: string }
  | { type: 'replay'; id: string }

export type HostEvent =
  | { type: 'data'; id: string; data: string }
  | { type: 'exit'; id: string; exitCode: number; signal: number | null }
  | { type: 'replay'; id: string; data: string }
  | { type: 'error'; id: string; message: string }
