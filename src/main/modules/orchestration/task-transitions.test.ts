import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { migrate } from '../shell/db'
import { migrations } from '../shell/migrations'
import { readBranchPullRequest, resolveBranchPullRequestRepository } from '../review/pull-request'
import { createTaskTransitions } from './task-transitions'

vi.mock('../projects/registry', () => ({ checkedProjectPath: async (_db: unknown, id: string) => id === 'p' ? '/projet' : '/autre' }))
vi.mock('../review/pull-request', () => ({
  readBranchPullRequest: vi.fn(),
  resolveBranchPullRequestRepository: vi.fn(),
}))

let db: DatabaseSync
const notify = vi.fn()
const startedAt = Date.parse('2026-11-25T18:00:00Z')
const branch = 'feat/42-tableau'
const status = () => db.prepare('SELECT status FROM tasks WHERE id = 1').get()?.status

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveBranchPullRequestRepository).mockResolvedValue('example/projet')
  db = new DatabaseSync(':memory:')
  migrate(db, migrations)
  db.exec(
    "INSERT INTO projects (id, path, git_dir, name, added_at) VALUES ('p', '/projet', '/projet/.git', 'projet', 0)",
  )
  db.prepare(
    "INSERT INTO agent_sessions (id, agent, cwd, state, created_at, updated_at) VALUES ('s', 'codex', '/supprime', 'working', ?, ?)",
  ).run(startedAt, startedAt)
  db.prepare(
    "INSERT INTO tasks (id, project_id, title, body, status, agent_session_id, agent_branch) VALUES (1, 'p', 'Tableau', '', 'doing', 's', ?)",
  ).run(branch)
})
afterEach(() => db.close())

it('attend la fin, passe en revue à l’ouverture de la PR, puis finit à sa fusion', async () => {
  const transitions = createTaskTransitions(db, notify)
  await transitions.refresh()
  expect(readBranchPullRequest).not.toHaveBeenCalled()
  expect(status()).toBe('doing')

  db.exec("UPDATE agent_sessions SET state = 'done'")
  await transitions.refresh()
  expect(readBranchPullRequest).toHaveBeenCalledWith('/projet', branch, startedAt, 'example/projet')
  expect(status()).toBe('doing')

  vi.mocked(readBranchPullRequest).mockResolvedValue('OPEN')
  await transitions.refresh()
  expect(status()).toBe('review')
  expect(notify).toHaveBeenCalledExactlyOnceWith('p')

  vi.mocked(readBranchPullRequest).mockResolvedValue('MERGED')
  await transitions.refresh()
  expect(status()).toBe('done')
  expect(notify).toHaveBeenCalledTimes(2)
})

it('préserve les changements locaux et retente après une erreur temporaire', async () => {
  db.exec("UPDATE agent_sessions SET state = 'done'")
  const transitions = createTaskTransitions(db, notify)
  const lookup = vi.mocked(readBranchPullRequest)
  lookup.mockRejectedValueOnce(new Error('hors ligne')).mockImplementationOnce(async () => {
    db.exec("UPDATE tasks SET status = 'todo' WHERE id = 1")
    return 'MERGED'
  })
  await transitions.refresh()
  expect(status()).toBe('doing')
  await transitions.refresh()
  expect(status()).toBe('todo')
  expect(notify).not.toHaveBeenCalled()
})

it('écarte un résultat reçu après la reprise de l’agent ou la fermeture de l’application', async () => {
  db.exec("UPDATE agent_sessions SET state = 'done'")
  const transitions = createTaskTransitions(db, notify)
  vi.mocked(readBranchPullRequest).mockImplementationOnce(async () => {
    db.exec("UPDATE agent_sessions SET state = 'working'")
    return 'MERGED'
  })
  await transitions.refresh()
  expect(status()).toBe('doing')

  db.exec("UPDATE agent_sessions SET state = 'done'")
  vi.mocked(readBranchPullRequest).mockImplementationOnce(async () => {
    transitions.close()
    return 'MERGED'
  })
  await transitions.refresh()
  expect(status()).toBe('doing')
  expect(notify).not.toHaveBeenCalled()
})


it('permet à un autre projet d’avancer alors qu’une lecture reste bloquée', async () => {
  db.exec(`
    UPDATE agent_sessions SET state = 'done';
    INSERT INTO projects (id, path, git_dir, name, added_at) VALUES ('a', '/autre', '/autre/.git', 'autre', 0);
    INSERT INTO tasks (id, project_id, title, body, status, agent_session_id, agent_branch) VALUES
      (2, 'p', 'Deuxième tâche du projet lent', '', 'doing', 's', 'feat/lente'),
      (3, 'a', 'Tâche indépendante', '', 'doing', 's', 'feat/independante');
  `)
  let release!: () => void
  const blocked = new Promise<void>((resolve) => { release = resolve })
  vi.mocked(readBranchPullRequest).mockImplementation(async (repo, head) => {
    if (repo === '/projet' && head === branch) await blocked
    return 'OPEN'
  })
  const cycle = createTaskTransitions(db, notify).refresh()
  try {
    await vi.waitFor(() => {
      expect(db.prepare('SELECT status FROM tasks WHERE id = 3').get()?.status).toBe('review')
    }, { timeout: 500 })
    expect(status()).toBe('doing')
  } finally {
    release()
    await cycle
  }
  expect(status()).toBe('review')
  expect(vi.mocked(resolveBranchPullRequestRepository).mock.calls.flat().sort()).toEqual(['/autre', '/projet'])
})
