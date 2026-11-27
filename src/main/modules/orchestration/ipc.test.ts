import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { IpcChannel } from '../../../shared/ipc'

type Invoke = (event: IpcMainInvokeEvent, raw: unknown) => Promise<unknown>
const handlers = new Map<IpcChannel, Invoke>()

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, app: {}, BrowserWindow: class {} }))
// On garde la vraie validation zod ; seule la vérification de l'émetteur (testée dans shell) est neutralisée.
vi.mock('../shell/ipc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shell/ipc')>()
  return {
    ...actual,
    handle: (channel: IpcChannel, fn: Parameters<typeof actual.validated>[1]) =>
      handlers.set(channel, actual.validated(channel, fn, () => true)),
  }
})
const { migrate } = await import('../shell/db')
const { migrations } = await import('../shell/migrations')
const { registerTaskHandlers } = await import('./ipc')

const projectId = randomUUID()
let db: DatabaseSync
const invoke = (channel: IpcChannel, raw: unknown) => handlers.get(channel)!({} as IpcMainInvokeEvent, raw)

beforeEach(() => {
  db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true })
  migrate(db, migrations)
  db.prepare('INSERT INTO projects (id, path, git_dir, name, added_at) VALUES (?, ?, ?, ?, ?)').run(
    projectId, '/repo', '/repo/.git', 'repo', 0,
  )
  registerTaskHandlers(db, { start: vi.fn() })
})
afterEach(() => db.close())

it('crée, édite puis déplace une tâche du projet', async () => {
  const [created] = (await invoke('tasks:create', { projectId, title: ' Tâche ', body: '' })) as { id: number }[]
  await invoke('tasks:update', { projectId, id: created!.id, title: 'Renommée', body: 'Corps' })
  await expect(invoke('tasks:move', { projectId, id: created!.id, status: 'doing' })).resolves.toEqual([
    { id: created!.id, title: 'Renommée', body: 'Corps', status: 'doing', issueNumber: null, issueUrl: null },
  ])
  await expect(invoke('tasks:list', { projectId })).resolves.toHaveLength(1)
})

it.each([
  ['un titre vide', 'tasks:create', { projectId, title: '  ', body: '' }],
  ['une colonne inconnue', 'tasks:move', { projectId, id: 1, status: 'archived' }],
  ['un projet qui n’est pas un uuid', 'tasks:list', { projectId: 'x' }],
  ['un agent inconnu', 'tasks:dispatch', { projectId, id: 1, agent: 'inconnu' }],
  ['un import sans projet valide', 'tasks:importIssues', { projectId: 'x' }],
] as const)('rejette %s', async (_label, channel, raw) => {
  await expect(invoke(channel, raw)).rejects.toThrow(/Requête IPC invalide/)
})

it('rejette un projet inconnu', async () => {
  await expect(invoke('tasks:list', { projectId: randomUUID() })).rejects.toThrow(/inconnu/)
})
