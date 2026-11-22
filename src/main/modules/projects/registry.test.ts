import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../shell/db'
import { migrations } from '../shell/migrations'
import { addProject, listProjects, removeProject, repoRoot, scanForRepos } from './registry'

let dir: string
let db: DatabaseSync

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' })
function makeRepo(path: string): string {
  mkdirSync(path, { recursive: true })
  git(path, 'init', '-q', '-b', 'main')
  git(path, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init')
  return path
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'wu-projects-')))
  db = openDatabase(join(dir, 'app.db'), migrations)
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('repoRoot', () => {
  it('remonte à la racine depuis un sous-dossier', async () => {
    const repo = makeRepo(join(dir, 'app'))
    mkdirSync(join(repo, 'src/deep'), { recursive: true })
    await expect(repoRoot(join(repo, 'src/deep'))).resolves.toBe(repo)
  })

  it("ramène un worktree lié au dépôt principal", async () => {
    const repo = makeRepo(join(dir, 'app'))
    git(repo, 'worktree', 'add', '-q', join(dir, 'app-feat'), '-b', 'feat')
    await expect(repoRoot(join(dir, 'app-feat'))).resolves.toBe(repo)
  })

  it("refuse un dossier qui n'est pas un dépôt git", async () => {
    mkdirSync(join(dir, 'plain'))
    await expect(repoRoot(join(dir, 'plain'))).rejects.toThrow(/pas un dépôt git/)
  })

  it('refuse un chemin qui n’existe pas', async () => {
    await expect(repoRoot(join(dir, 'nope'))).rejects.toThrow(/introuvable/)
  })
})

describe('registre', () => {
  it('ajoute un projet, le liste et le retire sans toucher au disque', async () => {
    const repo = makeRepo(join(dir, 'app'))
    const project = await addProject(db, repo)
    expect(project).toMatchObject({ path: repo, name: 'app' })
    expect(listProjects(db)).toEqual([project])

    removeProject(db, project.id)
    expect(listProjects(db)).toEqual([])
    await expect(repoRoot(repo)).resolves.toBe(repo)
  })

  it('ajouter deux fois le même dépôt (ou un de ses sous-dossiers) ne crée pas de doublon', async () => {
    const repo = makeRepo(join(dir, 'app'))
    mkdirSync(join(repo, 'src'))
    const first = await addProject(db, repo)
    const second = await addProject(db, join(repo, 'src'))
    expect(second.id).toBe(first.id)
    expect(listProjects(db)).toHaveLength(1)
  })

  it('trie les projets par nom', async () => {
    await addProject(db, makeRepo(join(dir, 'zeta')))
    await addProject(db, makeRepo(join(dir, 'alpha')))
    expect(listProjects(db).map((p) => p.name)).toEqual(['alpha', 'zeta'])
  })
})

describe('scanForRepos', () => {
  it('trouve les dépôts sur 2 niveaux et ignore le reste', async () => {
    const root = join(dir, 'projects')
    makeRepo(join(root, 'a'))
    makeRepo(join(root, 'group/b'))
    makeRepo(join(root, 'group/sub/too-deep'))
    makeRepo(join(root, 'node_modules/dep'))
    makeRepo(join(root, '.hidden'))
    mkdirSync(join(root, 'plain'))
    writeFileSync(join(root, 'file.txt'), '')
    expect((await scanForRepos(root)).sort()).toEqual([join(root, 'a'), join(root, 'group/b')])
  })

  it("ne descend pas dans un dépôt (pas de sous-modules ni de dossiers internes)", async () => {
    const root = join(dir, 'projects')
    const a = makeRepo(join(root, 'a'))
    makeRepo(join(a, 'nested'))
    expect(await scanForRepos(root)).toEqual([a])
  })
})
