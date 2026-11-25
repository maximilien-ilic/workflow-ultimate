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
    { id: expect.any(Number), title: 'Écrire le test', body: 'Avant le code.', status: 'todo' },
  ])
})

it('édite et déplace une tâche', () => {
  const tasks = createTasks(db)
  const created = tasks.create(PROJECT, { title: 'Brouillon', body: '' })
  tasks.update(PROJECT, created.id, { title: 'Titre final', body: 'Détails' })
  tasks.move(PROJECT, created.id, 'review')
  expect(tasks.list(PROJECT)).toEqual([{ id: created.id, title: 'Titre final', body: 'Détails', status: 'review' }])
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
