import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { changedFiles, fileVersions, parseNameStatus } from './changes'

let dir: string
let repo: string
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
const commit = (cwd: string, msg: string) =>
  git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', msg)

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'wu-review-')))
  repo = join(dir, 'app')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'garde.txt'), 'inchangé\n')
  writeFileSync(join(repo, 'modif.txt'), 'avant\n')
  writeFileSync(join(repo, 'supprime.txt'), 'disparait\n')
  writeFileSync(
    join(repo, 'ancien-nom.txt'),
    'contenu assez long pour être reconnu comme renommé\n'.repeat(5),
  )
  git(repo, 'add', '.')
  commit(repo, 'base')
  git(repo, 'switch', '-q', '-c', 'feat/x')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('parseNameStatus', () => {
  it('lit ajouts, modifications, suppressions et renommages (-z)', () => {
    const raw = ['M', 'a.ts', 'A', 'b.ts', 'D', 'c.ts', 'R092', 'old.ts', 'new.ts', ''].join('\0')
    expect(parseNameStatus(raw)).toEqual([
      { status: 'modified', path: 'a.ts' },
      { status: 'added', path: 'b.ts' },
      { status: 'deleted', path: 'c.ts' },
      { status: 'renamed', path: 'new.ts', oldPath: 'old.ts' },
    ])
  })
})

describe('changedFiles', () => {
  it('liste tout ce qui diffère du point de départ de la branche, commité ou non, nouveaux fichiers compris', async () => {
    writeFileSync(join(repo, 'modif.txt'), 'après\n')
    commit(repo, 'modif commitée')
    unlinkSync(join(repo, 'supprime.txt')) // non commité
    git(repo, 'mv', 'ancien-nom.txt', 'nouveau-nom.txt')
    writeFileSync(join(repo, 'nouveau.txt'), 'neuf\n') // non suivi
    const { base, files } = await changedFiles(repo)
    expect(base).toBe('main')
    expect(files).toEqual([
      { status: 'modified', path: 'modif.txt' },
      { status: 'renamed', path: 'nouveau-nom.txt', oldPath: 'ancien-nom.txt' },
      { status: 'added', path: 'nouveau.txt' },
      { status: 'deleted', path: 'supprime.txt' },
    ])
  })
})

describe('fileVersions', () => {
  it('donne le contenu avant (point de départ) et après (dossier de travail)', async () => {
    writeFileSync(join(repo, 'modif.txt'), 'après\n')
    const { mergeBase } = await changedFiles(repo)
    expect(await fileVersions(repo, mergeBase, { status: 'modified', path: 'modif.txt' })).toEqual({
      binary: false,
      before: 'avant\n',
      after: 'après\n',
    })
  })

  it('un lien symbolique est montré comme sa cible (comme git), jamais suivi hors du worktree', async () => {
    writeFileSync(join(dir, 'secret.txt'), 'NE PAS LIRE\n')
    symlinkSync(join(dir, 'secret.txt'), join(repo, 'lien'))
    const { mergeBase } = await changedFiles(repo)
    const v = await fileVersions(repo, mergeBase, { status: 'added', path: 'lien' })
    expect(v.after).toBe(join(dir, 'secret.txt'))
    expect(v.after).not.toContain('NE PAS LIRE')
  })

  it('signale un binaire sans en envoyer le contenu, et refuse un chemin qui sort du worktree', async () => {
    writeFileSync(join(repo, 'image.bin'), Buffer.from([0x89, 0x50, 0, 0, 1, 2]))
    const { mergeBase } = await changedFiles(repo)
    expect(await fileVersions(repo, mergeBase, { status: 'added', path: 'image.bin' })).toEqual({
      binary: true,
      before: '',
      after: '',
    })
    await expect(
      fileVersions(repo, mergeBase, { status: 'modified', path: '../../etc/passwd' }),
    ).rejects.toThrow(/hors du worktree/)
  })
})
