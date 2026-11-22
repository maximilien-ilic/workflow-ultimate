import { execFile, type ExecFileException } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export type GitStatus = {
  branch: string | null
  shortSha: string | null
  modified: number
  staged: number
  untracked: number
  ahead: number | null
  behind: number | null
}

export function parseGitStatus(output: string): GitStatus {
  const status: GitStatus = {
    branch: null,
    shortSha: null,
    modified: 0,
    staged: 0,
    untracked: 0,
    ahead: null,
    behind: null,
  }

  const records = output.split('\0')
  for (let index = 0; index < records.length; index++) {
    const record = records[index] ?? ''
    switch (record.slice(0, 2)) {
      case '# ': {
        if (record.startsWith('# branch.head ')) {
          const head = record.slice('# branch.head '.length)
          status.branch = head === '(detached)' ? null : head
        } else if (record.startsWith('# branch.oid ')) {
          const oid = record.slice('# branch.oid '.length)
          status.shortSha = oid === '(initial)' ? null : oid.slice(0, 7)
        } else {
          const counts = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record)
          if (counts) {
            status.ahead = Number(counts[1])
            status.behind = Number(counts[2])
          }
        }
        break
      }
      case '1 ':
      case '2 ':
        if (record[2] !== '.') status.staged++
        if (record[3] !== '.') status.modified++
        if (record.startsWith('2 ')) index++ // Le renommage contient un deuxième chemin.
        break
      case 'u ':
        status.modified++ // Le conflit reste à résoudre avant de pouvoir être indexé.
        break
      case '? ':
        status.untracked++
        break
    }
  }

  return status
}

export async function gitStatus(path: string): Promise<GitStatus> {
  try {
    const { stdout } = await exec(
      'git',
      ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--ahead-behind'],
      {
        cwd: path,
        encoding: 'utf8',
        timeout: 5_000,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
      },
    )
    return parseGitStatus(stdout)
  } catch (error) {
    const { stderr, killed, message } = error as ExecFileException & { stderr?: string }
    if (stderr?.startsWith('fatal: not a git repository')) {
      throw new Error(`« ${path} » n’est pas un dépôt Git`, { cause: error })
    }

    const detail = killed ? 'délai de 5 s dépassé' : stderr?.trim() || message
    throw new Error(`Impossible de lire l’état Git de « ${path} » (${detail})`, { cause: error })
  }
}
