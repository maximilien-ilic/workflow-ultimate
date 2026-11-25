import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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

  it('traite les noms de fichiers comme des chemins littéraux', async () => {
    writeFileSync(join(repo, 'fichier[1].txt'), 'choisi\n')
    writeFileSync(join(repo, 'fichier1.txt'), 'non choisi\n')
    const sha = await commitChanges(repo, 'feat: fichier choisi', ['fichier[1].txt'])
    expect(git(repo, 'show', '--format=', '--name-only', sha)).toBe('fichier[1].txt')
    expect(git(repo, 'status', '--short')).toBe('?? fichier1.txt')
  })

  it('commite les deux côtés d’un renommage déjà indexé', async () => {
    git(repo, 'mv', 'a.txt', 'renommé.txt')
    writeFileSync(join(repo, 'autre.txt'), 'indexé séparément\n')
    git(repo, 'add', 'autre.txt')
    const sha = await commitChanges(repo, 'refactor: renommer le fichier', ['a.txt', 'renommé.txt'])
    expect(git(repo, 'ls-tree', '--name-only', '-z', sha)).toBe('renommé.txt\0')
    expect(git(repo, 'status', '--short')).toBe('A  autre.txt')
  })

  it('conserve les fichiers déjà commités dans le diff sans les recommiter ni bloquer', async () => {
    git(repo, 'rm', 'a.txt')
    git(repo, 'commit', '-qm', 'supprimer a')
    writeFileSync(join(repo, 'b.txt'), 'nouveau\n')
    const sha = await commitChanges(repo, 'feat: ajouter b', ['a.txt', 'b.txt'])
    expect(git(repo, 'show', '--format=', '--name-only', sha)).toBe('b.txt')
  })

  it('préserve HEAD, l’index et le dossier de travail si Git refuse le commit partiel', async () => {
    writeFileSync(join(repo, 'a.txt'), 'version indexée\n')
    git(repo, 'add', 'a.txt')
    writeFileSync(join(repo, 'a.txt'), 'version sur disque\n')
    writeFileSync(join(repo, 'b.txt'), 'non suivi\n')
    git(repo, 'config', 'user.name', '')
    git(repo, 'config', 'user.email', '')
    const indexPath = git(repo, 'rev-parse', '--path-format=absolute', '--git-path', 'index')
    const head = git(repo, 'rev-parse', 'HEAD')
    const before = readFileSync(indexPath)

    await expect(commitChanges(repo, 'refusé', ['a.txt', 'b.txt'])).rejects.toThrow(/ident|name/i)

    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head)
    expect(readFileSync(indexPath)).toEqual(before)
    expect(git(repo, 'show', ':a.txt')).toBe('version indexée')
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('version sur disque\n')
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toBe('non suivi\n')
    expect(git(repo, 'status', '--porcelain')).toBe('MM a.txt\n?? b.txt')
  })

  it('préserve les fichiers indexés hors sélection après un commit réussi', async () => {
    writeFileSync(join(repo, 'a.txt'), 'version indexée\n')
    git(repo, 'add', 'a.txt')
    writeFileSync(join(repo, 'a.txt'), 'nouvelle version sur disque\n')
    writeFileSync(join(repo, 'b.txt'), 'nouveau\n')

    await commitChanges(repo, 'ajouter b', ['b.txt'])

    expect(git(repo, 'show', 'HEAD:a.txt')).toBe('a')
    expect(git(repo, 'show', ':a.txt')).toBe('version indexée')
    expect(git(repo, 'show', 'HEAD:b.txt')).toBe('nouveau')
    expect(git(repo, 'status', '--short')).toBe('MM a.txt')
  })

  it('respecte un verrou Git existant dans un worktree lié', async () => {
    const linked = join(dir, 'lié')
    git(repo, 'worktree', 'add', '-qb', 'feat/lié', linked)
    const lock = git(linked, 'rev-parse', '--path-format=absolute', '--git-path', 'index') + '.lock'
    writeFileSync(lock, 'verrou détenu par Git')
    writeFileSync(join(linked, 'b.txt'), 'nouveau\n')
    const head = git(linked, 'rev-parse', 'HEAD')

    await expect(commitChanges(linked, 'ajouter b', ['b.txt'])).rejects.toThrow(/index\.lock/)
    expect(readFileSync(lock, 'utf8')).toBe('verrou détenu par Git')
    expect(git(linked, 'rev-parse', 'HEAD')).toBe(head)

    rmSync(lock)
    await commitChanges(linked, 'ajouter b', ['b.txt'])
    expect(git(linked, 'status', '--short')).toBe('')
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head)
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

  it('ne pousse que la branche courante même avec push.default=matching', async () => {
    const remote = join(dir, 'remote.git')
    git(repo, 'push', '-q', 'origin', 'main')
    await pushBranch(repo)
    const remoteMain = git(remote, 'rev-parse', 'main')
    git(repo, 'switch', '-q', 'main')
    git(repo, 'commit', '-qm', 'commit local sur main', '--allow-empty')
    git(repo, 'switch', '-q', 'feat/1-x')
    git(repo, 'commit', '-qm', 'commit à pousser', '--allow-empty')
    git(repo, 'config', 'push.default', 'matching')
    await pushBranch(repo)
    expect(git(remote, 'rev-parse', 'main')).toBe(remoteMain)
    expect(git(remote, 'log', '-1', '--format=%s', 'feat/1-x')).toBe('commit à pousser')
  })

  it('respecte un upstream portant un autre nom sur un autre distant', async () => {
    git(repo, 'remote', 'rename', 'origin', 'publication')
    git(repo, 'push', '-qu', 'publication', 'HEAD:refs/heads/revue')
    git(repo, 'commit', '-qm', 'nouvelle version', '--allow-empty')
    await pushBranch(repo)
    expect(git(join(dir, 'remote.git'), 'log', '-1', '--format=%s', 'revue')).toBe('nouvelle version')
  })

  it('garde la commande SSH configurée et impose le mode non interactif pour OpenSSH', async () => {
    const ssh = join(dir, 'ssh')
    writeFileSync(ssh, '#!/bin/sh\nprintf "SSH %s %s %s\\n" "$*" "$SSH_ASKPASS_REQUIRE" "$GIT_TERMINAL_PROMPT" >&2\nexit 1\n', {
      mode: 0o700,
    })
    const quotedSsh = "'" + ssh.replaceAll("'", "'\\''") + "'"
    git(repo, 'config', 'core.sshCommand', `${quotedSsh} -o ConnectTimeout=3`)
    git(repo, 'config', 'ssh.variant', 'ssh')
    git(repo, 'remote', 'set-url', 'origin', 'ssh://review.invalid/repo.git')
    await expect(pushBranch(repo)).rejects.toThrow(/SSH -o ConnectTimeout=3 -o BatchMode=yes .* never 0/)
  })
})
