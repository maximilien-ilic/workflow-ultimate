import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gitStatus, parseGitStatus } from './git-status'

describe('parseGitStatus', () => {
  it('compte chaque côté de XY et ignore le second chemin des renommages', () => {
    const oid = '0123456789abcdef0123456789abcdef01234567'
    const modes = 'N... 100644 100644 100644'
    const hashes = oid + ' ' + oid
    const output = [
      '# branch.oid ' + oid,
      '# branch.head topic',
      '# branch.upstream origin/topic',
      '# branch.ab +12 -2',
      '# autre en-tête',
      '1 .M ' + modes + ' ' + hashes + ' fichier\navec retour',
      '1 MM ' + modes + ' ' + hashes + ' fichier partiellement indexé',
      '2 R. ' + modes + ' ' + hashes + ' R100 nouveau nom',
      '? ancien nom avec préfixe trompeur',
      '? non suivi',
      '! ignoré',
      '',
    ].join('\0')

    expect(parseGitStatus(output)).toEqual({
      branch: 'topic',
      shortSha: '0123456',
      modified: 2,
      staged: 2,
      untracked: 1,
      ahead: 12,
      behind: 2,
    })
  })

  it('compte un conflit comme une modification à résoudre', () => {
    const oid = '0123456789abcdef0123456789abcdef01234567'
    const conflict = 'u UU N... 100644 100644 100644 100644 ' + [oid, oid, oid].join(' ') + ' conflit'
    expect(parseGitStatus('# branch.head main\0' + conflict + '\0')).toMatchObject({
      modified: 1,
      staged: 0,
    })
  })
})

describe('gitStatus', () => {
  let dir: string
  let repo: string

  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim()

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wu-git-status-'))
    repo = join(dir, 'dépôt avec espaces')
    mkdirSync(repo)
    git('init', '--initial-branch=main')
    git('config', '--local', 'user.name', 'Test Workflow Ultimate')
    git('config', '--local', 'user.email', 'test@example.invalid')
    git('config', '--local', 'core.hooksPath', join(dir, 'no-hooks'))
    writeFileSync(join(repo, 'tracked'), 'initial\n')
    git('add', 'tracked')
    git('commit', '--no-gpg-sign', '-m', 'Initial')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('lit une branche propre sans upstream', async () => {
    expect(await gitStatus(repo)).toEqual({
      branch: 'main',
      shortSha: git('rev-parse', '--short=7', 'HEAD'),
      modified: 0,
      staged: 0,
      untracked: 0,
      ahead: null,
      behind: null,
    })
  })

  it('distingue les modifications, les fichiers indexés et chaque fichier non suivi', async () => {
    writeFileSync(join(repo, 'tracked'), 'modifié\n')
    writeFileSync(join(repo, 'staged'), 'indexé\n')
    git('add', 'staged')
    git('config', '--local', 'status.showUntrackedFiles', 'no')
    mkdirSync(join(repo, 'nouveau'))
    writeFileSync(join(repo, 'nouveau', 'premier\nfichier'), 'a\n')
    writeFileSync(join(repo, 'nouveau', 'second'), 'b\n')
    expect(await gitStatus(repo)).toMatchObject({ modified: 1, staged: 1, untracked: 2 })
  })

  it('compte un commit en avance sur la branche suivie', async () => {
    const remote = join(dir, 'remote.git')
    git('init', '--bare', '--initial-branch=main', remote)
    git('remote', 'add', 'origin', remote)
    git('push', '--set-upstream', 'origin', 'main')
    git('commit', '--no-gpg-sign', '--allow-empty', '-m', 'Un commit en avance')
    expect(await gitStatus(repo)).toMatchObject({ ahead: 1, behind: 0 })
  })

  it('renvoie le SHA court pour un HEAD détaché', async () => {
    git('switch', '--detach', 'HEAD')
    expect(await gitStatus(repo)).toMatchObject({
      branch: null,
      shortSha: git('rev-parse', '--short=7', 'HEAD'),
    })
  })

  it('renvoie la branche sans SHA pour un dépôt sans commit', async () => {
    const empty = join(dir, 'empty')
    git('init', '--initial-branch=empty', empty)
    expect(await gitStatus(empty)).toMatchObject({ branch: 'empty', shortSha: null })
  })

  it('identifie un dossier hors dépôt', async () => {
    await expect(gitStatus(dir)).rejects.toThrow(/n’est pas un dépôt Git/)
  })
})
