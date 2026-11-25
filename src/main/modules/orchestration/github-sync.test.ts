import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ipcRequestSchemas, TASK_BODY_MAX_LENGTH } from '../../../shared/ipc'
import { migrate } from '../shell/db'
import { migrations } from '../shell/migrations'
import { syncIssues } from './github-sync'
import { createTasks } from './tasks'

const PROJECT = 'project'
const FIXTURE = resolve('tests/fixtures/gh-issue-list.json')
let repo: string
let db: DatabaseSync

// Faux `gh` placé en tête du PATH : il note ses arguments et renvoie la sortie demandée.
function fakeGh(output: string) {
  writeFileSync(join(repo, 'gh'), `#!/bin/sh\necho "$@" > "${join(repo, 'args')}"\ncat "${output}"\n`, {
    mode: 0o700,
  })
}

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'wu-issues-')))
  execFileSync('git', ['init', '-q', repo])
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

it('importe les issues, ouvertes en « À faire » et fermées en « Fini »', async () => {
  fakeGh(FIXTURE)
  await syncIssues(db, PROJECT)
  expect(readFileSync(join(repo, 'args'), 'utf8')).toMatch(/^issue list --state all --limit \d+ --json number,title,body,state,url\n$/)
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

it('réimporte sans doublon : garde la colonne choisie, passe à Fini une issue fermée depuis', async () => {
  fakeGh(FIXTURE)
  await syncIssues(db, PROJECT)
  const tasks = createTasks(db)
  const open = tasks.list(PROJECT).find(({ issueNumber }) => issueNumber === 12)!
  tasks.move(PROJECT, open.id, 'doing')

  const closedLater = join(repo, 'closed.json')
  writeFileSync(closedLater, JSON.stringify([
    { number: 12, title: 'Ajouter le tableau', body: '', state: 'OPEN', url: open.issueUrl },
  ]))
  fakeGh(closedLater)
  await syncIssues(db, PROJECT)
  expect(tasks.list(PROJECT).map(({ issueNumber, status }) => [issueNumber, status])).toEqual([[12, 'doing'], [7, 'done']])

  writeFileSync(closedLater, JSON.stringify([
    { number: 12, title: 'Tableau livré', body: '', state: 'CLOSED', url: open.issueUrl },
  ]))
  await syncIssues(db, PROJECT)
  expect(tasks.list(PROJECT)).toHaveLength(2)
  expect(tasks.list(PROJECT)[0]).toMatchObject({ id: open.id, title: 'Tableau livré', status: 'done' })
})

it('remonte l’erreur de gh sans rien importer', async () => {
  writeFileSync(join(repo, 'gh'), `#!/bin/sh\necho 'gh: not logged in' >&2\nexit 1\n`, { mode: 0o700 })
  await expect(syncIssues(db, PROJECT)).rejects.toThrow('gh: not logged in')
  expect(createTasks(db).list(PROJECT)).toEqual([])
})

it('n’appelle pas gh quand le dossier du projet désigne un autre dépôt', async () => {
  fakeGh(FIXTURE)
  db.prepare('UPDATE projects SET git_dir = ? WHERE id = ?').run('/ailleurs/.git', PROJECT)
  await expect(syncIssues(db, PROJECT)).rejects.toThrow(/n'est plus le dépôt du projet/)
  expect(existsSync(join(repo, 'args'))).toBe(false)
})

it('tronque un corps trop long pour que la tâche reste éditable', async () => {
  const long = join(repo, 'long.json')
  writeFileSync(long, JSON.stringify([
    { number: 1, title: 'Long', body: 'x'.repeat(TASK_BODY_MAX_LENGTH + 1), state: 'OPEN', url: 'https://github.com/e/p/issues/1' },
  ]))
  fakeGh(long)
  await syncIssues(db, PROJECT)
  const [task] = createTasks(db).list(PROJECT)
  expect(task!.body).toHaveLength(TASK_BODY_MAX_LENGTH)
  const edit = { projectId: crypto.randomUUID(), id: task!.id, title: task!.title, body: task!.body }
  expect(ipcRequestSchemas['tasks:update'].safeParse(edit).success).toBe(true)
})

it('refuse une sortie de gh inattendue', async () => {
  const invalid = join(repo, 'invalid.json')
  writeFileSync(invalid, JSON.stringify([{ number: 'douze' }]))
  fakeGh(invalid)
  await expect(syncIssues(db, PROJECT)).rejects.toThrow()
  expect(createTasks(db).list(PROJECT)).toEqual([])
})
