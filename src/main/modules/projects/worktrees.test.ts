import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { branchForIssue, createWorktree, listWorktrees, removeWorktree } from './worktrees'

let dir: string
let repo: string
let workspaces: string
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'wu-wt-')))
  repo = join(dir, 'app')
  workspaces = join(dir, 'workspaces')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init')
  git(repo, 'branch', 'existante')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('branchForIssue', () => {
  it.each([
    [12, 'Créer/supprimer un worktree (avec garde-fou)', 'feat/12-creer-supprimer-un-worktree-avec-garde'],
    [3, '   ', 'feat/3'],
    [7, 'x'.repeat(80), `feat/7-${'x'.repeat(40)}`],
  ])('#%i « %s » → %s', (n, title, branch) => {
    expect(branchForIssue(n, title)).toBe(branch)
  })
})

describe('worktrees', () => {
  it('liste le worktree principal', async () => {
    expect(await listWorktrees(repo)).toEqual([{ path: repo, branch: 'main', main: true }])
  })

  it('crée un worktree sur une nouvelle branche, rangé dans <workspaces>/<projet>/<nom>', async () => {
    const path = await createWorktree(repo, workspaces, { branch: 'feat/12-x', create: true })
    expect(path).toBe(join(workspaces, 'app', 'feat-12-x'))
    expect(await listWorktrees(repo)).toContainEqual({ path, branch: 'feat/12-x', main: false })
  })

  it('crée un worktree sur une branche existante', async () => {
    const path = await createWorktree(repo, workspaces, { branch: 'existante', create: false })
    expect(git(path, 'branch', '--show-current').trim()).toBe('existante')
  })

  it('refuse un nom de branche invalide et un dossier déjà pris', async () => {
    await expect(createWorktree(repo, workspaces, { branch: 'a..b', create: true })).rejects.toThrow(
      /invalide/,
    )
    mkdirSync(join(workspaces, 'app', 'pris'), { recursive: true })
    await expect(createWorktree(repo, workspaces, { branch: 'pris', create: true })).rejects.toThrow(
      /existe déjà/,
    )
  })

  it('supprime un worktree propre et nettoie git', async () => {
    const path = await createWorktree(repo, workspaces, { branch: 'feat/a', create: true })
    await removeWorktree(repo, path, { force: false })
    expect(existsSync(path)).toBe(false)
    expect((await listWorktrees(repo)).map((w) => w.path)).toEqual([repo])
  })

  it('refuse de supprimer un worktree avec des changements non commités, sauf confirmation', async () => {
    const path = await createWorktree(repo, workspaces, { branch: 'feat/b', create: true })
    writeFileSync(join(path, 'travail.txt'), 'non commité')
    await expect(removeWorktree(repo, path, { force: false })).rejects.toThrow(/1 fichier\(s\) non commité/)
    expect(existsSync(join(path, 'travail.txt'))).toBe(true)
    await removeWorktree(repo, path, { force: true })
    expect(existsSync(path)).toBe(false)
  })

  it('crée et supprime normalement quand le dossier des workspaces passe par un lien symbolique', async () => {
    mkdirSync(join(dir, 'vrai-home'))
    symlinkSync(join(dir, 'vrai-home'), join(dir, 'home-lien'))
    const path = await createWorktree(repo, join(dir, 'home-lien'), { branch: 'feat/f', create: true })
    expect(path).toBe(join(dir, 'vrai-home', 'app', 'feat-f'))
    await removeWorktree(repo, path, { force: false })
    expect(existsSync(path)).toBe(false)
  })

  it('refuse un chemin dont un parent a été remplacé par un lien symbolique', async () => {
    const path = await createWorktree(repo, workspaces, { branch: 'feat/c', create: true })
    // Le dossier du projet dans workspaces devient un lien vers un autre dossier qui imite le worktree.
    const elsewhere = join(dir, 'ailleurs')
    renameSync(join(workspaces, 'app'), elsewhere)
    symlinkSync(elsewhere, join(workspaces, 'app'))
    writeFileSync(join(elsewhere, 'feat-c', 'sentinelle'), 'à garder')
    await expect(removeWorktree(repo, path, { force: true })).rejects.toThrow(/lien symbolique/)
    expect(existsSync(join(elsewhere, 'feat-c', 'sentinelle'))).toBe(true)
  })

  it("ne retire pas l'enregistrement d'un autre worktree temporairement absent", async () => {
    const a = await createWorktree(repo, workspaces, { branch: 'feat/d', create: true })
    const b = await createWorktree(repo, workspaces, { branch: 'feat/e', create: true })
    renameSync(b, `${b}.deplace`) // ex. disque amovible démonté
    await removeWorktree(repo, a, { force: false })
    expect((await listWorktrees(repo)).map((w) => w.path)).toContain(b)
    renameSync(`${b}.deplace`, b)
  })

  it("ne supprime jamais le worktree principal ni un dossier qui n'est pas un worktree du projet", async () => {
    await expect(removeWorktree(repo, repo, { force: true })).rejects.toThrow(/principal/)
    const other = join(dir, 'autre')
    mkdirSync(other)
    await expect(removeWorktree(repo, other, { force: true })).rejects.toThrow(/pas un worktree/)
    expect(existsSync(other)).toBe(true)
  })
})
