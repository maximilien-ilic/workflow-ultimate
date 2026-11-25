import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPullRequest, readPullRequest } from './pull-request'

let repo: string
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' })

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'wu-pr-'))
  git('init', '-qb', 'feat/42-contexte')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty',
    '-qm', 'feat: état de la CI', '-m', 'Détail du changement.')
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
  writeFileSync(join(repo, 'gh'), '#!/bin/sh\n' + script, { mode: 0o700 })
}

it('préremplit le titre, le corps et la fermeture du ticket à partir du worktree', async () => {
  fakeGh('echo "no pull requests found for branch" >&2; exit 1')
  await expect(readPullRequest(repo)).resolves.toEqual({
    kind: 'draft', branch: 'feat/42-contexte', title: 'feat: état de la CI',
    body: 'Détail du changement.\n\nCloses #42',
  })
})

it.each([['pending', 8], ['fail', 1]])('conserve les checks %s même si gh sort avec le code %i', async (bucket, code) => {
  fakeGh(`
    case "$2" in
      view) echo '{"number":9,"title":"Contexte","url":"https://github.com/example/projet/pull/9","state":"OPEN"}' ;;
      checks) echo '[{"name":"CI","bucket":"${bucket}"}]'; exit ${code} ;;
    esac
  `)
  await expect(readPullRequest(repo)).resolves.toMatchObject({
    kind: 'existing', number: 9, checks: [{ name: 'CI', bucket }],
  })
})

it('publie le brouillon sur la branche attendue sans invite ni push implicite', async () => {
  fakeGh(`
    [ "$GH_PROMPT_DISABLED" = 1 ] && [ -z "$GH_REPO" ] || exit 2
    [ "$1" = pr ] && [ "$2" = create ] && [ "$3" = '--head=feat/42-contexte' ] || exit 3
    [ "$4" = '--title=--titre' ] && [ "$5" = '--body=Un corps' ] || exit 4
    echo 'https://github.com/example/projet/pull/9'
  `)
  await expect(createPullRequest(repo, 'feat/42-contexte', '--titre', 'Un corps')).resolves.toEqual({
    url: 'https://github.com/example/projet/pull/9',
  })
  await expect(createPullRequest(repo, 'ancienne-branche', 'Titre', '')).rejects.toThrow(/branche a changé/)
})

it('affiche les erreurs d’authentification', async () => {
  fakeGh('echo "Run gh auth login" >&2; exit 4')
  await expect(readPullRequest(repo)).rejects.toThrow('Run gh auth login')
})
