import type { NotifyTarget } from './claude-code'

export function codexArgs(opts: { notify: NotifyTarget; prompt?: string; resumeId?: string }): string[] {
  const command = [
    'env',
    'ELECTRON_RUN_AS_NODE=1',
    opts.notify.node,
    opts.notify.script,
    'codex',
    'turn-finished',
  ]
  // Un tableau de chaînes JSON est aussi un tableau TOML, sans interprétation par un shell.
  const notify = JSON.stringify(command).replaceAll('\u007f', '\\u007f')
  const args = ['-c', `notify=${notify}`]
  if (opts.resumeId) return [...args, 'resume', opts.resumeId]
  return opts.prompt ? [...args, '--', opts.prompt] : args
}
