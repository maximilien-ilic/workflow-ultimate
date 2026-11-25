import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitChanges, pushBranch } from './commit'

let dir: string
let repo: string
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'wu-commit-')))
  repo = join(dir, 'app')
  mkdirSync(repo)
  git(dir, 'init', '-q', '--bare', 'remote.git')
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.name', 't')
  git(repo, 'config', 'user.email', 't@t')
  git(repo, 'remote', 'add', 'origin', join(dir, 'remote.git'))
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'base')
  git(repo, 'switch', '-q', '-c', 'feat/1-x')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('commitChanges', () => {
  it('commite seulement les fichiers choisis', async () => {
    writeFileSync(join(repo, 'a.txt'), 'modifié\n')
    writeFileSync(join(repo, 'b.txt'), 'nouveau\n')
    const sha = await commitChanges(repo, 'feat: seulement b', ['b.txt'])
    expect(git(repo, 'show', '--name-only', '--format=%s', sha)).toBe('feat: seulement b\n\nb.txt')
    expect(git(repo, 'status', '--porcelain')).toBe('M a.txt')
  })

  it('commite tout sans liste de fichiers', async () => {
    writeFileSync(join(repo, 'a.txt'), 'modifié\n')
    await commitChanges(repo, 'feat: tout')
    expect(git(repo, 'status', '--porcelain')).toBe('')
  })

  it("affiche l'erreur de git telle quelle quand il n'y a rien à commiter", async () => {
    await expect(commitChanges(repo, 'vide')).rejects.toThrow(/nothing to commit|rien à valider/)
  })
})

describe('pushBranch', () => {
  it("crée l'upstream au premier push, puis pousse normalement", async () => {
    writeFileSync(join(repo, 'a.txt'), 'v2\n')
    await commitChanges(repo, 'feat: v2')
    await pushBranch(repo)
    expect(git(repo, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/feat/1-x')
    writeFileSync(join(repo, 'a.txt'), 'v3\n')
    await commitChanges(repo, 'feat: v3')
    await pushBranch(repo)
    expect(git(join(dir, 'remote.git'), 'log', '-1', '--format=%s', 'feat/1-x')).toBe('feat: v3')
  })
})
