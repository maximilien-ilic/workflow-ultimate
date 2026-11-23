import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gitEnv } from './git-env'
import { gitStatus } from './git-status'

describe('gitEnv', () => {
  it('retire les variables GIT_* héritées qui redirigent git vers un autre dépôt', () => {
    const env = gitEnv({
      PATH: '/bin',
      HOME: '/h',
      GIT_DIR: '/x/.git',
      GIT_WORK_TREE: '/x',
      GIT_INDEX_FILE: '/i',
    })
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' })
  })
})

describe('gitStatus avec un environnement git hérité', () => {
  let dir: string
  const saved = { ...process.env }
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'wu-git-env-'))))
  afterEach(() => {
    process.env = { ...saved }
    rmSync(dir, { recursive: true, force: true })
  })

  it('lit le dépôt demandé, pas celui de GIT_DIR', async () => {
    const make = (name: string, branch: string) => {
      const repo = join(dir, name)
      mkdirSync(repo)
      execFileSync('git', ['init', '-q', '-b', branch], { cwd: repo })
      return repo
    }
    const wanted = make('voulu', 'voulu-main')
    const other = make('autre', 'autre-main')
    process.env['GIT_DIR'] = join(other, '.git')
    expect((await gitStatus(wanted)).branch).toBe('voulu-main')
  })
})
