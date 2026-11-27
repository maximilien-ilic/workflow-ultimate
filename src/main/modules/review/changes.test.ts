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

it('liste un retour local à la base et le compare à HEAD sans masquer les autres commits', async () => {
  writeFileSync(join(repo, 'modif.txt'), 'version commitée\n')
  writeFileSync(join(repo, 'garde.txt'), 'autre changement commité\n')
  commit(repo, 'modifications de branche')
  writeFileSync(join(repo, 'modif.txt'), 'avant\n')

  const changes = await changedFiles(repo)
  expect(changes.files).toEqual([
    { status: 'modified', path: 'garde.txt' },
    { status: 'modified', path: 'modif.txt' },
  ])
  const { head, headFiles, mergeBase } = changes
  expect(headFiles).toEqual(['modif.txt'])
  expect(await fileVersions(repo, head, changes.files[1]!)).toEqual({
    binary: false, before: 'version commitée\n', after: 'avant\n',
  })
  expect(await fileVersions(repo, mergeBase, changes.files[0]!)).toEqual({
    binary: false, before: 'inchangé\n', after: 'autre changement commité\n',
  })
})

describe('changedFiles, cas limites', () => {
  it("compare à origin/<branche> quand la branche de base n'existe qu'à distance", async () => {
    const clone = join(dir, 'clone')
    git(dir, 'clone', '-q', repo, clone) // origin/HEAD → origin/feat/x (branche active du dépôt source)
    git(repo, 'switch', '-q', 'main')
    git(clone, 'fetch', '-q', 'origin', 'main:refs/remotes/origin/main')
    git(clone, 'remote', 'set-head', 'origin', 'main')
    git(clone, 'switch', '-q', '-c', 'feat/clone')
    const { base } = await changedFiles(clone)
    expect(base).toBe('origin/main')
  })

  it("un fichier retiré de l'index mais resté sur le disque n'apparaît qu'une fois", async () => {
    git(repo, 'rm', '-q', '--cached', 'garde.txt')
    const { files } = await changedFiles(repo)
    expect(files.filter((f) => f.path === 'garde.txt')).toHaveLength(1)
  })
})

describe('fileVersions', () => {
  it('affiche les références avant et après pour un sous-module ajouté, avancé ou retiré', async () => {
    const library = join(dir, 'lib')
    git(dir, 'init', '-q', '-b', 'main', library)
    writeFileSync(join(library, 'fichier'), 'version initiale')
    git(library, 'add', '.')
    commit(library, 'initial')
    const initial = git(library, 'rev-parse', 'HEAD').trim()
    git(repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', library, 'component')
    const versions = async () => {
      const { mergeBase, files } = await changedFiles(repo)
      const change = files.find(({ path }) => path === 'component')
      expect(change).toBeDefined()
      return fileVersions(repo, mergeBase, change!)
    }

    expect(await versions()).toEqual({ binary: false, before: '', after: `Subproject commit ${initial}\n` })
    commit(repo, 'ajoute component')
    git(repo, 'branch', '-f', 'main', 'HEAD')

    const component = join(repo, 'component')
    writeFileSync(join(component, 'fichier'), 'nouvelle version')
    commit(component, 'avance')
    const advanced = git(component, 'rev-parse', 'HEAD').trim()
    expect(await versions()).toEqual({
      binary: false,
      before: `Subproject commit ${initial}\n`,
      after: `Subproject commit ${advanced}\n`,
    })
    git(repo, 'add', 'component')
    expect((await versions()).after).toBe(`Subproject commit ${advanced}\n`)

    git(repo, 'rm', '-qf', 'component')
    expect(await versions()).toEqual({ binary: false, before: `Subproject commit ${initial}\n`, after: '' })
  })

  it('refuse un chemin dont un dossier parent est un lien symbolique vers l’extérieur', async () => {
    mkdirSync(join(dir, 'dehors'))
    writeFileSync(join(dir, 'dehors', 'secret.txt'), 'NE PAS LIRE\n')
    symlinkSync(join(dir, 'dehors'), join(repo, 'lien-dossier'))
    const { mergeBase } = await changedFiles(repo)
    await expect(
      fileVersions(repo, mergeBase, { status: 'added', path: 'lien-dossier/secret.txt' }),
    ).rejects.toThrow(/hors du worktree/)
  })

  it('ne lit jamais un fichier spécial (FIFO) : il bloquerait', async () => {
    execFileSync('mkfifo', [join(repo, 'tube')])
    const { mergeBase } = await changedFiles(repo)
    await expect(fileVersions(repo, mergeBase, { status: 'added', path: 'tube' })).resolves.toMatchObject({
      binary: true,
    })
  })

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
