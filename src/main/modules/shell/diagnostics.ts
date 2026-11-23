import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { sep } from 'node:path'
import { app } from 'electron'
import { agentSocketPath } from '../agents/socket'
import { globalShortcutStatus } from './global-shortcuts'
import { logDirectory } from './log'
import { appDirectory } from './paths'

const cliVersions = {
  claude: /^(\d{1,6}\.\d{1,6}\.\d{1,6}) \(Claude Code\)$/m,
  codex: /^codex-cli (\d{1,6}\.\d{1,6}\.\d{1,6})(?:-[\da-z.-]+)?$/im,
  git: /^git version (\d{1,6}\.\d{1,6}\.\d{1,6})(?:[.-][\da-z.-]+)?$/im,
  gh: /^gh version (\d{1,6}\.\d{1,6}\.\d{1,6})(?: \(\d{4}-\d{2}-\d{2}\))?$/m,
}

function cliVersion(command: string, pattern: RegExp): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      command,
      ['--version'],
      {
        timeout: 1500,
        killSignal: 'SIGKILL',
        maxBuffer: 8 * 1024,
        env: { PATH: process.env['PATH'], HOME: homedir(), LC_ALL: 'C', NO_COLOR: '1' },
      },
      (error, stdout) => {
        if (error?.code === 'ENOENT') resolve('introuvable')
        else resolve((!error && pattern.exec(stdout)?.[1]) || 'version indisponible')
      },
    )
  })
}

function displayPath(path: string): string {
  const home = homedir()
  const abbreviated = path === home || path.startsWith(home + sep) ? '~' + path.slice(home.length) : path
  return abbreviated.replaceAll('\n', '\\n').replaceAll('\r', '\\r')
}

export async function buildDiagnosticsReport(): Promise<string> {
  const [socket, ...versions] = await Promise.all([
    agentSocketPath().catch(() => 'indisponible'),
    ...Object.entries(cliVersions).map(
      async ([command, pattern]) => `${command} : ${await cliVersion(command, pattern)}`,
    ),
  ])
  return [
    `Workflow Ultimate ${app.getVersion()}`,
    `Electron : ${process.versions.electron ?? 'indisponible'}`,
    `Node : ${process.versions.node}`,
    '',
    `Configuration : ${displayPath(appDirectory('config'))}`,
    `Données : ${displayPath(appDirectory('data'))}`,
    `Journaux : ${displayPath(logDirectory())}`,
    `Socket agents : ${displayPath(socket)}`,
    '',
    ...versions,
    '',
    `Raccourcis globaux : ${globalShortcutStatus().message}`,
  ].join('\n')
}
