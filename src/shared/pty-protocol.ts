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
  // Ferme le terminal : termine le processus s'il tourne, puis libère son tampon dès sa fin.
  | { type: 'kill'; id: string }
  | { type: 'replay'; id: string }
  // Contrôle de flux : le main suspend la lecture du PTY tant que le renderer n'a pas rattrapé son retard.
  | { type: 'pause'; id: string }
  | { type: 'resume'; id: string }

export type HostEvent =
  // Confirmation de lancement : le main ne répond « créé » au renderer qu'après cet événement.
  | { type: 'spawned'; id: string; pid: number }
  // offset : nombre total de caractères émis par ce terminal, ce morceau compris.
  | { type: 'data'; id: string; data: string; offset: number }
  | { type: 'exit'; id: string; exitCode: number; signal: number | null }
  // Les derniers caractères (au plus la taille du tampon), jusqu'à `offset` inclus.
  | { type: 'replay'; id: string; data: string; offset: number }
  | { type: 'error'; id: string; message: string }
