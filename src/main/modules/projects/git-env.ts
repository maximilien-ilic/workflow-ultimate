import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// Environnement des appels git de l'appli. On retire toutes les variables GIT_* héritées
// (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE…) : lancée depuis un hook ou un terminal d'agent,
// l'appli lirait sinon un autre dépôt que celui demandé.
export function gitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('GIT_')))
  // Pas de verrou optionnel : ne jamais gêner un agent qui travaille dans le même dépôt.
  return { ...clean, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }
}

const exec = promisify(execFile)

// Lance git sans shell, avec l'environnement nettoyé et un délai. Renvoie stdout sans le \n final
// (un seul \n retiré : un chemin qui contient un retour à la ligne reste intact).
export async function runGit(cwd: string, args: string[], timeout = 10_000): Promise<string> {
  const { stdout } = await exec('git', ['-C', cwd, ...args], {
    timeout,
    env: gitEnv(),
    maxBuffer: 16 * 1024 * 1024,
  })
  return stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout
}
