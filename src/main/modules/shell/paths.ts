import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

const directories = {
  config: ['XDG_CONFIG_HOME', '.config'],
  data: ['XDG_DATA_HOME', '.local/share'],
  state: ['XDG_STATE_HOME', '.local/state'],
} as const

export function appDirectory(kind: keyof typeof directories): string {
  const [variable, fallback] = directories[kind]
  const configured = process.env[variable] ?? ''
  return join(isAbsolute(configured) ? configured : join(homedir(), fallback), 'workflow-ultimate')
}
