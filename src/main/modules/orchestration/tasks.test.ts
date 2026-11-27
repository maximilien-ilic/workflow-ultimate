import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { migrate } from '../shell/db'
import { migrations } from '../shell/migrations'
import { createTasks } from './tasks'

const PROJECT = 'project'
const OTHER_PROJECT = 'other'
let db: DatabaseSync

const insertProject = (id: string) =>
  db.prepare('INSERT INTO projects (id, path, git_dir, name, added_at) VALUES (?, ?, ?, ?, ?)').run(
    id, `/${id}`, `/${id}/.git`, id, 0,
  )

beforeEach(() => {
  db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true })
  migrate(db, migrations)
  insertProject(PROJECT)
  insertProject(OTHER_PROJECT)
})
afterEach(() => db.close())

it('crée une tâche « À faire » et la liste seulement dans son projet', () => {
  const tasks = createTasks(db)
  tasks.create(PROJECT, { title: 'Écrire le test', body: 'Avant le code.' })
  tasks.create(OTHER_PROJECT, { title: 'Ailleurs', body: '' })
  expect(tasks.list(PROJECT)).toEqual([
    { id: expect.any(Number), title: 'Écrire le test', body: 'Avant le code.', status: 'todo', issueNumber: null, issueUrl: null },
  ])
})

it('édite et déplace une tâche', () => {
  const tasks = createTasks(db)
  const created = tasks.create(PROJECT, { title: 'Brouillon', body: '' })
  tasks.update(PROJECT, created.id, { title: 'Titre final', body: 'Détails' })
  tasks.move(PROJECT, created.id, 'review')
  expect(tasks.list(PROJECT)).toEqual([
    { id: created.id, title: 'Titre final', body: 'Détails', status: 'review', issueNumber: null, issueUrl: null },
  ])
})

it('refuse de modifier la tâche d’un autre projet', () => {
  const tasks = createTasks(db)
  const foreign = tasks.create(OTHER_PROJECT, { title: 'Ailleurs', body: '' })
  expect(() => tasks.move(PROJECT, foreign.id, 'done')).toThrow('Tâche inconnue')
  expect(() => tasks.update(PROJECT, foreign.id, { title: 'x', body: '' })).toThrow('Tâche inconnue')
  expect(tasks.list(OTHER_PROJECT)[0]).toMatchObject({ title: 'Ailleurs', status: 'todo' })
})

it('supprime les tâches avec leur projet', () => {
  createTasks(db).create(PROJECT, { title: 'Orpheline', body: '' })
  db.prepare('DELETE FROM projects WHERE id = ?').run(PROJECT)
  expect(createTasks(db).list(PROJECT)).toEqual([])
})

it('migre les tâches existantes et efface seulement le lien quand la session est supprimée', () => {
  using previous = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true })
  migrate(previous, migrations.slice(0, 7))
  previous.exec("INSERT INTO projects (id, path, git_dir, name, added_at) VALUES ('p', '/p', '/p/.git', 'p', 0)")
  previous.exec("INSERT INTO tasks (id, project_id, title, body, status) VALUES (1, 'p', 'Ancienne tâche', 'À conserver', 'todo')")
  migrate(previous, migrations)
  const linked = previous.prepare('SELECT agent_session_id, agent_branch FROM tasks WHERE id = ?')
  expect(linked.get(1)).toEqual({ agent_session_id: null, agent_branch: null })
  expect(createTasks(previous).list('p')).toEqual([
    { id: 1, title: 'Ancienne tâche', body: 'À conserver', status: 'todo', issueNumber: null, issueUrl: null },
  ])

  previous.exec("INSERT INTO agent_sessions (id, agent, cwd, state, created_at, updated_at) VALUES ('a', 'codex', '/p', 'done', 0, 0)")
  previous.prepare('UPDATE tasks SET agent_session_id = ?, agent_branch = ? WHERE id = ?').run('a', 'feat/1-tache', 1)
  previous.exec("DELETE FROM agent_sessions WHERE id = 'a'")
  expect(linked.get(1)).toEqual({ agent_session_id: null, agent_branch: 'feat/1-tache' })
})


it('reconnaît une ancienne branche de tâche locale sans masquer celle d’une issue importée', () => {
  const tasks = createTasks(db)
  const associate = db.prepare('UPDATE tasks SET agent_branch = ? WHERE project_id = ?')
  tasks.create(PROJECT, { title: 'Tâche locale', body: '' })
  tasks.saveIssue(OTHER_PROJECT, {
    title: 'Issue importée', body: '', status: 'todo', issueNumber: 42, issueUrl: 'https://github.com/a/b/issues/42',
  })
  const branch = 'feat/42-contexte'
  associate.run(branch, PROJECT)
  associate.run(branch, OTHER_PROJECT)

  expect(tasks.ownsLocalBranch(PROJECT, branch)).toBe(true)
  expect(tasks.ownsLocalBranch(OTHER_PROJECT, branch)).toBe(false)
  expect(tasks.ownsLocalBranch(PROJECT, 'feat/7-autre')).toBe(false)
})
