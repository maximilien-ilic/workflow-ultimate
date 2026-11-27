import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { migrate } from '../shell/db'
import { migrations } from '../shell/migrations'
import { createReviewComments } from './comments'

const target = { projectId: 'project', worktreePath: '/repo' }
let db: DatabaseSync

beforeEach(() => {
  db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true })
  migrate(db, migrations.slice(0, -1))
  db.prepare('INSERT INTO projects (id, path, git_dir, name, added_at) VALUES (?, ?, ?, ?, ?)').run(
    target.projectId, '/repo', '/repo/.git', 'repo', 0,
  )
  migrate(db, migrations)
})
afterEach(() => db.close())

it('conserve les commentaires par worktree et marque uniquement le lot effectivement transmis', async () => {
  const comments = createReviewComments(db)
  comments.add(target, { path: 'src/a.ts', line: 3, body: 'Vérifier le total.' })
  comments.add(target, { path: 'src/b.ts', line: 7, body: 'Ajouter un test.' })
  const another = { ...target, worktreePath: '/autre' }
  comments.add(another, { path: 'src/a.ts', line: 1, body: 'Autre worktree' })

  const write = vi.fn(async () => {
    comments.add(target, { path: 'src/c.ts', line: 1, body: 'Ajout pendant l’envoi' })
  })
  await expect(comments.send(target, write)).resolves.toBe(2)
  expect(write).toHaveBeenCalledExactlyOnceWith(
    '\x1b[200~Commentaires de revue :\nsrc/a.ts:3 — Vérifier le total.\nsrc/b.ts:7 — Ajouter un test.\x1b[201~\r',
  )
  expect(createReviewComments(db).list(target).map(({ sentAt }) => sentAt !== null)).toEqual([true, true, false])
  expect(comments.list(another)[0]?.sentAt).toBeNull()
})

it('garde les commentaires en attente quand le PTY refuse l’écriture', async () => {
  const comments = createReviewComments(db)
  comments.add(target, { path: 'a', line: 1, body: 'Question' })
  let failWrite!: (error: Error) => void
  const write = new Promise<void>((_, reject) => { failWrite = reject })
  const sending = comments.send(target, () => write)
  expect(comments.list(target)[0]?.sentAt).toBeNull()
  failWrite(new Error('PTY fermé'))
  await expect(sending).rejects.toThrow('PTY fermé')
  expect(comments.list(target)[0]?.sentAt).toBeNull()
})
