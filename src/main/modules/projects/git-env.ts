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

// Variables qui feraient lire ou configurer un autre dépôt que celui du dossier courant.
const GIT_REPOSITORY_REDIRECTS = new Set([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
])

export const redirectsGitRepository = (name: string) =>
  GIT_REPOSITORY_REDIRECTS.has(name) || /^GIT_CONFIG_(PARAMETERS|COUNT|KEY_\d+|VALUE_\d+)$/.test(name)

// Pour parler à un dépôt distant : garder les identifiants et agents existants et couper les invites.
export function remoteGitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const kept = Object.entries(env).filter(([name]) => !redirectsGitRepository(name))
  return {
    ...Object.fromEntries(kept),
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '/bin/false',
    SSH_ASKPASS_REQUIRE: 'never',
    GCM_INTERACTIVE: 'never',
    LC_ALL: 'C',
  }
}
