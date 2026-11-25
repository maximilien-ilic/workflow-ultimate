import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPullRequest, readPullRequest } from './pull-request'

let repo: string
let publishedSha: string
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' })

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'wu-pr-'))
  git('init', '-qb', 'feat/42-contexte')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty',
    '-qm', 'feat: état de la CI', '-m', 'Détail du changement.')
  publishedSha = git('rev-parse', 'HEAD').toString().trim()
  git('remote', 'add', 'origin', 'https://github.com/example/projet.git')
  git('update-ref', 'refs/remotes/origin/feat/42-contexte', 'HEAD')
  git('branch', '--set-upstream-to=origin/feat/42-contexte')
  vi.stubEnv('PATH', repo + ':' + process.env.PATH)
  vi.stubEnv('GH_REPO', 'autre/depot')
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(repo, { recursive: true, force: true })
})

function fakeGh(script: string) {
  writeFileSync(join(repo, 'gh'), `#!/bin/sh
case "$1 $2" in
  'repo view') echo '{"url":"https://github.com/example/projet"}'; exit 0 ;;
esac
` + script, { mode: 0o700 })
}

it('préremplit le titre, le corps et la fermeture du ticket à partir du worktree', async () => {
  fakeGh('echo "[]"')
  await expect(readPullRequest(repo)).resolves.toEqual({
    kind: 'draft', branch: 'feat/42-contexte', title: 'feat: état de la CI',
    body: 'Détail du changement.\n\nCloses #42',
  })
})

it.each([['pending', 8], ['fail', 1]])('conserve les checks %s même si gh sort avec le code %i', async (bucket, code) => {
  fakeGh(`
    case "$2" in
      list) echo '[{"number":9,"title":"Contexte","url":"https://github.com/example/projet/pull/9","state":"OPEN","headRepository":{"nameWithOwner":"example/projet"}}]' ;;
      checks) echo '[{"name":"CI","bucket":"${bucket}"}]'; exit ${code} ;;
    esac
  `)
  await expect(readPullRequest(repo)).resolves.toMatchObject({
    kind: 'existing', number: 9, checks: [{ name: 'CI', bucket }],
  })
})

it('cherche et publie dans le même dépôt avec le nom de branche distant', async () => {
  git('remote', 'set-url', 'origin', 'https://github.com/autre/projet.git')
  git('remote', 'add', 'publication', 'git@github.com:example/projet.git')
  git('update-ref', 'refs/remotes/publication/revue/42', 'HEAD')
  git('branch', '--set-upstream-to=publication/revue/42')
  fakeGh(`
    [ "$GH_PROMPT_DISABLED" = 1 ] && [ -z "$GH_REPO" ] || exit 2
    case "$1 $2" in
      'pr list')
        [ "$3" = '--repo=github.com/example/projet' ] && [ "$4" = '--head=revue/42' ] || exit 3
        echo '[]' ;;
      'api --hostname')
        [ "$3" = github.com ] && [ "$4" = repos/example/projet/git/ref/heads/revue/42 ] || exit 4
        echo '{"object":{"sha":"${publishedSha}"}}' ;;
      'pr create')
        [ "$3" = '--repo=github.com/example/projet' ] && [ "$4" = '--head=revue/42' ] || exit 5
        [ "$5" = '--title=--titre' ] && [ "$6" = '--body=Un corps' ] || exit 6
        echo 'https://github.com/example/projet/pull/9' ;;
    esac
  `)
  await expect(readPullRequest(repo)).resolves.toMatchObject({ kind: 'draft', branch: 'feat/42-contexte' })
  await expect(createPullRequest(repo, 'feat/42-contexte', '--titre', 'Un corps')).resolves.toEqual({
    url: 'https://github.com/example/projet/pull/9',
  })
  await expect(createPullRequest(repo, 'ancienne-branche', 'Titre', '')).rejects.toThrow(/branche a changé/)
})

it('ignore une PR issue d’une branche homonyme sur un fork', async () => {
  fakeGh(`
    [ "$2" = list ] || exit 8
    echo '[{"number":9,"title":"Autre dépôt","url":"https://github.com/example/projet/pull/9","state":"OPEN","headRepository":{"nameWithOwner":"autre/projet"}}]'
  `)
  await expect(readPullRequest(repo)).resolves.toMatchObject({ kind: 'draft' })
})

it('refuse un push vers un fork avant toute création', async () => {
  git('remote', 'set-url', '--push', 'origin', 'git@github.com:exemple-fork/projet.git')
  fakeGh('echo "gh inattendu" >&2; exit 8')
  await expect(createPullRequest(repo, 'feat/42-contexte', 'Titre', '')).rejects.toThrow(/fork/)
})

it('demande de pousser quand un commit local suit la révision publiée', async () => {
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-qm', 'Plus récent')
  fakeGh(`
    [ "$1" = api ] || exit 8
    echo '{"object":{"sha":"${publishedSha}"}}'
  `)
  await expect(createPullRequest(repo, 'feat/42-contexte', 'Titre', '')).rejects.toThrow(/Poussez/)
})

it('demande de pousser quand la branche est absente sur GitHub', async () => {
  fakeGh(`
    [ "$1" = api ] || exit 8
    echo 'gh: Not Found (HTTP 404)' >&2
    exit 1
  `)
  await expect(createPullRequest(repo, 'feat/42-contexte', 'Titre', '')).rejects.toThrow(/Poussez/)
})

it('affiche les erreurs d’authentification', async () => {
  fakeGh('echo "Run gh auth login" >&2; exit 4')
  await expect(readPullRequest(repo)).rejects.toThrow('Run gh auth login')
})

it.each(['CLOSED', 'MERGED'])('permet une nouvelle PR après une PR %s', async (state) => {
  fakeGh(`
    case "$1 $2" in
      'pr list')
        if [ "$5" = '--state=open' ]; then echo '[]'; exit 0; fi
        echo '[{"number":9,"title":"Ancienne PR","url":"https://github.com/example/projet/pull/9","state":"${state}","headRepository":{"nameWithOwner":"example/projet"}}]' ;;
      'pr checks') echo '[]' ;;
      'api --hostname') echo '{"object":{"sha":"${publishedSha}"}}' ;;
      'pr create') echo 'https://github.com/example/projet/pull/10' ;;
    esac
  `)
  await expect(readPullRequest(repo)).resolves.toMatchObject({ kind: 'draft', branch: 'feat/42-contexte' })
  await expect(createPullRequest(repo, 'feat/42-contexte', 'Nouvelle PR', '')).resolves.toEqual({
    url: 'https://github.com/example/projet/pull/10',
  })
})
