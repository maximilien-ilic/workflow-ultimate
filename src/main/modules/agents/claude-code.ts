// Adaptateur Claude Code : arguments du CLI et hooks injectés par --settings (JSON en ligne),
// sans jamais modifier ~/.claude. Les hooks appellent wu-notify, qui écrit sur le socket des agents.

export type NotifyTarget = { node: string; script: string }
type Hook = { hooks: { type: 'command'; command: string; timeout: number }[] }

export const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

// Le Node embarqué dans l'appli (ELECTRON_RUN_AS_NODE) : pas besoin de Node installé sur la machine.
const notifyCommand = ({ node, script }: NotifyTarget, event: string) =>
  `ELECTRON_RUN_AS_NODE=1 ${shellQuote(node)} ${shellQuote(script)} claude-code ${event}`

export function claudeHookSettings(notify: NotifyTarget): { hooks: Record<string, Hook[]> } {
  const hook = (event: string): Hook[] => [
    { hooks: [{ type: 'command', command: notifyCommand(notify, event), timeout: 5 }] },
  ]
  return {
    hooks: {
      UserPromptSubmit: hook('prompt-submitted'),
      Notification: hook('needs-input'), // demande de permission ou attente d'une réponse
      Stop: hook('turn-finished'),
    },
  }
}

export function claudeArgs(opts: {
  sessionId: string
  resume: boolean
  prompt?: string
  notify: NotifyTarget
}): string[] {
  // Notre id de session devient celui de Claude : la reprise est un simple --resume <id>.
  const session = opts.resume ? ['--resume', opts.sessionId] : ['--session-id', opts.sessionId]
  const settings = ['--settings', JSON.stringify(claudeHookSettings(opts.notify))]
  // `--` : un prompt qui commence par un tiret reste un prompt, jamais une option.
  const prompt = !opts.resume && opts.prompt ? ['--', opts.prompt] : []
  return [...session, ...settings, ...prompt]
}
