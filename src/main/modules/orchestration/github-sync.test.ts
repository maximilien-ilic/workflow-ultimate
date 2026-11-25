import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ipcRequestSchemas, TASK_BODY_MAX_LENGTH } from '../../../shared/ipc'
import { migrate } from '../shell/db'
import { migrations } from '../shell/migrations'
import { ISSUES_PER_PAGE, syncIssues } from './github-sync'
import { createTasks } from './tasks'

const PROJECT = 'project'
const SOURCE = 'example/projet'
const FIXTURE = resolve('tests/fixtures/gh-issues-page.json')
let repo: string
let db: DatabaseSync

// Faux `gh` en tête du PATH : il note chaque appel, donne la source du dépôt et sert les pages `page-N.json`.
const FAKE_GH = `#!/bin/sh
dir=$(dirname "$0")
echo "$@" >> "$dir/args"
case "$1 $2" in
  'repo view') cat "$dir/repo.json"; exit 0 ;;
esac
page=$(echo "$@" | sed -n 's/.*[?&]page=\\([0-9]*\\).*/\\1/p')
cat "$dir/page-$page.json" 2>/dev/null || echo '{"count":0,"issues":[]}'
`
const calls = () => readFileSync(join(repo, 'args'), 'utf8').trimEnd().split('\n')
const setSource = (nameWithOwner: string, host = 'github.com') =>
  writeFileSync(join(repo, 'repo.json'), JSON.stringify({ nameWithOwner, url: `https://${host}/${nameWithOwner}` }))
const boundSource = () => db.prepare('SELECT github_repo FROM projects WHERE id = ?').get(PROJECT)?.github_repo
const setPage = (page: number, content: unknown) => writeFileSync(join(repo, `page-${page}.json`), JSON.stringify(content))
const issue = (number: number, state: 'open' | 'closed', title = `Issue ${number}`, body = '') => ({
  number, title, body, state, url: `https://github.com/${SOURCE}/issues/${number}`,
})

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'wu-issues-')))
  execFileSync('git', ['init', '-q', repo])
  writeFileSync(join(repo, 'gh'), FAKE_GH, { mode: 0o700 })
  setSource(SOURCE)
  copyFileSync(FIXTURE, join(repo, 'page-1.json'))
  vi.stubEnv('PATH', `${repo}:${process.env.PATH}`)
  db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true })
  migrate(db, migrations)
  db.prepare('INSERT INTO projects (id, path, git_dir, name, added_at) VALUES (?, ?, ?, ?, ?)').run(
    PROJECT, repo, `${repo}/.git`, 'projet', 0,
  )
})
afterEach(() => {
  db.close()
  vi.unstubAllEnvs()
  rmSync(repo, { recursive: true, force: true })
})

it('importe les issues de la source du projet, ouvertes en « À faire » et fermées en « Fini »', async () => {
  await syncIssues(db, PROJECT)
  const [view, api] = calls()
  expect(view).toBe('repo view --json nameWithOwner,url')
  expect(api).toMatch(`api --hostname github.com repos/${SOURCE}/issues?state=all&per_page=${ISSUES_PER_PAGE}&page=1 --jq `)
  expect(calls()).toHaveLength(2)
  expect(createTasks(db).list(PROJECT)).toEqual([
    {
      id: expect.any(Number), title: 'Ajouter le tableau', body: 'Corps de l’issue ouverte.', status: 'todo',
      issueNumber: 12, issueUrl: 'https://github.com/example/projet/issues/12',
    },
    {
      id: expect.any(Number), title: 'Corriger le démarrage', body: '', status: 'done',
      issueNumber: 7, issueUrl: 'https://github.com/example/projet/issues/7',
    },
  ])
})

it('lit les pages une à une jusqu’à une page incomplète', async () => {
  // Une page pleine côté GitHub peut contenir des pull requests, écartées : `count` compte la page brute.
  setPage(1, { count: ISSUES_PER_PAGE, issues: [issue(1, 'open')] })
  setPage(2, { count: 1, issues: [issue(2, 'closed')] })
  await syncIssues(db, PROJECT)
  expect(calls().filter((call) => call.startsWith('api'))).toHaveLength(2)
  expect(createTasks(db).list(PROJECT).map(({ issueNumber, status }) => [issueNumber, status])).toEqual([
    [1, 'todo'], [2, 'done'],
  ])
})

it('réimporte sans doublon : garde la colonne choisie, passe à Fini une issue fermée depuis', async () => {
  await syncIssues(db, PROJECT)
  const tasks = createTasks(db)
  const open = tasks.list(PROJECT).find(({ issueNumber }) => issueNumber === 12)!
  tasks.move(PROJECT, open.id, 'doing')

  setPage(1, { count: 1, issues: [issue(12, 'open', 'Ajouter le tableau')] })
  await syncIssues(db, PROJECT)
  expect(tasks.list(PROJECT).map(({ issueNumber, status }) => [issueNumber, status])).toEqual([[12, 'doing'], [7, 'done']])

  setPage(1, { count: 1, issues: [issue(12, 'closed', 'Tableau livré')] })
  await syncIssues(db, PROJECT)
  expect(tasks.list(PROJECT)).toHaveLength(2)
  expect(tasks.list(PROJECT)[0]).toMatchObject({ id: open.id, title: 'Tableau livré', status: 'done' })
})

it('refuse d’importer depuis une autre source GitHub que celle du premier import', async () => {
  await syncIssues(db, PROJECT)
  const before = createTasks(db).list(PROJECT)
  setSource('example/other')
  setPage(1, { count: 1, issues: [issue(12, 'closed', 'Autre dépôt')] })
  await expect(syncIssues(db, PROJECT)).rejects.toThrow(/example\/projet.*example\/other/)
  expect(createTasks(db).list(PROJECT)).toEqual(before)
})

it('refuse clairement un dépôt hors de github.com, sans rien interroger ni enregistrer', async () => {
  setSource(SOURCE, 'ghe.example.com')
  await expect(syncIssues(db, PROJECT)).rejects.toThrow(/ghe\.example\.com.*github\.com/)
  expect(calls().some((call) => call.startsWith('api'))).toBe(false)
  expect(boundSource()).toBeNull()
})

it('n’enregistre rien quand une page suivante est refusée', async () => {
  setPage(1, { count: ISSUES_PER_PAGE, issues: [issue(1, 'open')] })
  setPage(2, { count: 1, issues: [{ number: 'deux' }] })
  await expect(syncIssues(db, PROJECT)).rejects.toThrow()
  expect(createTasks(db).list(PROJECT)).toEqual([])
  expect(boundSource()).toBeNull()
})

it('remonte l’erreur de gh sans rien importer', async () => {
  writeFileSync(join(repo, 'gh'), `#!/bin/sh\necho 'gh: not logged in' >&2\nexit 1\n`, { mode: 0o700 })
  await expect(syncIssues(db, PROJECT)).rejects.toThrow('gh: not logged in')
  expect(createTasks(db).list(PROJECT)).toEqual([])
})

it('n’appelle pas gh quand le dossier du projet désigne un autre dépôt', async () => {
  db.prepare('UPDATE projects SET git_dir = ? WHERE id = ?').run('/ailleurs/.git', PROJECT)
  await expect(syncIssues(db, PROJECT)).rejects.toThrow(/n'est plus le dépôt du projet/)
  expect(existsSync(join(repo, 'args'))).toBe(false)
})

it('tronque un corps trop long pour que la tâche reste éditable', async () => {
  setPage(1, { count: 1, issues: [issue(1, 'open', 'Long', 'x'.repeat(TASK_BODY_MAX_LENGTH + 1))] })
  await syncIssues(db, PROJECT)
  const [task] = createTasks(db).list(PROJECT)
  expect(task!.body).toHaveLength(TASK_BODY_MAX_LENGTH)
  const edit = { projectId: crypto.randomUUID(), id: task!.id, title: task!.title, body: task!.body }
  expect(ipcRequestSchemas['tasks:update'].safeParse(edit).success).toBe(true)
})

it('refuse une sortie de gh inattendue', async () => {
  setPage(1, { count: 1, issues: [{ number: 'douze' }] })
  await expect(syncIssues(db, PROJECT)).rejects.toThrow()
  expect(createTasks(db).list(PROJECT)).toEqual([])
})
