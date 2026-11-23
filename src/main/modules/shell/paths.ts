import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

const directories = {
  config: ['XDG_CONFIG_HOME', '.config'],
  data: ['XDG_DATA_HOME', '.local/share'],
  state: ['XDG_STATE_HOME', '.local/state'],
} as const

// Une valeur XDG relative est ignorée (spec XDG) : sinon le dossier dépendrait du répertoire de lancement.
export function appDirectory(
  kind: keyof typeof directories,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  const [variable, fallback] = directories[kind]
  const configured = env[variable] ?? ''
  return join(isAbsolute(configured) ? configured : join(home, fallback), 'workflow-ultimate')
}
