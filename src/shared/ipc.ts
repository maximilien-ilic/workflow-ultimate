import { z } from 'zod'
import { agentConcurrency, settingsSchema, type Settings } from './settings'
import { HISTORY_CHARACTERS, type PaneTree } from './terminal-history'

// Contrat unique main ↔ renderer. Pas d'import Node ni DOM ici.
// Ajouter un canal = un schéma de requête + un type de réponse.
const absolutePath = z.string().startsWith('/', 'chemin absolu attendu').max(4096)
export const maxAgentPromptLength = 20_000
export const maxWorktreeBranchLength = 200
const dimension = z.number().int().min(1).max(1000)

const paneTreeSchema: z.ZodType<PaneTree> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pane'), id: z.uuid() }).strict(),
  z.object({
    type: z.literal('split'),
    dir: z.enum(['row', 'column']),
    get a() { return paneTreeSchema },
    get b() { return paneTreeSchema },
  }).strict(),
])
export const terminalLayoutSchema = z.object({
  tabs: z.array(z.object({
    id: z.uuid(),
    title: z.string(),
    cwd: absolutePath,
    tree: paneTreeSchema,
    activePane: z.uuid(),
  }).strict()),
  activeTab: z.uuid().nullable(),
}).strict()

const terminalScreenSchema = z.object({
  data: z.string().max(HISTORY_CHARACTERS),
  cols: dimension,
  rows: dimension,
}).strict()
export const terminalHistorySchema = terminalScreenSchema.extend({ cwd: absolutePath })

export type TerminalLayout = z.infer<typeof terminalLayoutSchema>
export type TerminalHistory = z.infer<typeof terminalHistorySchema>

// Colonnes du tableau de tâches, dans l'ordre d'affichage.
export const taskStatuses = ['todo', 'doing', 'review', 'done'] as const
// Partagée avec l'import des issues GitHub : une tâche importée doit rester éditable.
const agentKind = z.enum(['claude-code', 'codex'])
export const TASK_BODY_MAX_LENGTH = 20_000
const taskDraft = { title: z.string().trim().min(1, 'titre vide').max(256), body: z.string().max(TASK_BODY_MAX_LENGTH) }
const taskId = z.number().int().positive()

export const ipcRequestSchemas = {
  'app:info': z.object({}).strict(),
  'projects:list': z.object({}).strict(),
  'projects:add': z.object({ path: absolutePath }).strict(),
  'projects:remove': z.object({ id: z.uuid() }).strict(),
  'projects:removeChecked': z.object({ id: z.uuid(), confirmedTaskCount: z.number().int().nonnegative().optional() }).strict(),
  // Ouvre le sélecteur de dossier du système : `repo` ajoute un dépôt, `scan` ajoute tous ceux trouvés dedans.
  'projects:pick': z.object({ mode: z.enum(['repo', 'scan']) }).strict(),
  'projects:orcaPreview': z.object({ manual: z.boolean() }).strict(),
  'projects:orcaImport': z
    .object({
      repos: z.array(absolutePath).max(2000),
      worktrees: z.array(absolutePath).max(2000),
      useWorkspace: z.boolean(),
    })
    .strict(),
  'projects:orcaDismiss': z.object({}).strict(),
  'diagnostics:report': z.object({}).strict(),
  'settings:get': z.object({}).strict(),
  'settings:set': settingsSchema,
  'worktrees:list': z.object({ projectId: z.uuid() }).strict(),
  'worktrees:status': z.object({ projectId: z.uuid() }).strict(),
  'worktrees:snapshot': z.object({ projectId: z.uuid() }).strict(),
  'worktrees:create': z
    .object({ projectId: z.uuid(), branch: z.string().min(1).max(maxWorktreeBranchLength), create: z.boolean() })
    .strict(),
  // Ticket GitHub #n → worktree sur la branche feat/<n>-<titre> (créée si besoin).
  'worktrees:createFromIssue': z.object({ projectId: z.uuid(), issue: z.number().int().positive() }).strict(),
  // Sans `force`, un worktree avec des changements non commités n'est pas supprimé : on renvoie leur nombre.
  'worktrees:remove': z.object({ projectId: z.uuid(), path: absolutePath, force: z.boolean() }).strict(),
  'terminal:create': z.object({ id: z.uuid(), cwd: absolutePath, cols: dimension, rows: dimension }).strict(),
  'terminal:write': z.object({ id: z.uuid(), data: z.string().max(65_536) }).strict(),
  'terminal:resize': z.object({ id: z.uuid(), cols: dimension, rows: dimension }).strict(),
  'terminal:kill': z.object({ id: z.uuid() }).strict(),
  // Renvoie la sortie déjà produite, puis le flux reprend en direct (après un rechargement du renderer).
  'terminal:attach': z.object({ id: z.uuid() }).strict(),
  // Accusé de réception : nombre de caractères affichés par le renderer (contrôle de flux).
  'terminal:ack': z.object({ id: z.uuid(), chars: z.number().int().min(0).max(10_000_000) }).strict(),
  'terminal:workspace': z.object({}).strict(),
  'terminal:saveLayout': terminalLayoutSchema,
  'terminal:loadHistory': z.object({ id: z.uuid() }).strict(),
  'terminal:saveHistory': terminalScreenSchema.extend({ id: z.uuid() }),
  'terminal:historyFlushed': z.object({}).strict(),
  // Lien cliqué dans un terminal : ouvert dans le navigateur du système, http(s) seulement.
  'shell:kdePalette': z.object({}).strict(),
  'shell:openUrl': z.object({ url: z.url({ protocol: /^https?$/ }).max(4096) }).strict(),
  // Lance l'agent dans un nouveau terminal `terminalId` (le renderer s'y rattache ensuite).
  'agents:start': z
    .object({
      terminalId: z.uuid(),
      cwd: absolutePath,
      agent: agentKind,
      prompt: z.string().max(maxAgentPromptLength).optional(),
      cols: dimension,
      rows: dimension,
    })
    .strict(),
  'agents:resume': z
    .object({ sessionId: z.uuid(), terminalId: z.uuid(), cols: dimension, rows: dimension })
    .strict(),
  'agents:list': z.object({}).strict(),
  // Diff d'un worktree par rapport au point de départ de sa branche.
  'review:changes': z.object({ projectId: z.uuid(), worktreePath: absolutePath }).strict(),
  'review:comparison': z.object({ projectId: z.uuid(), worktreePath: absolutePath }).strict(),
  // Indexe les fichiers choisis (tous si `paths` est absent), commite, puis pousse à part.
  'review:commit': z
    .object({
      projectId: z.uuid(),
      worktreePath: absolutePath,
      message: z.string().trim().min(1, 'message de commit vide').max(10_000),
      paths: z.array(z.string().min(1).max(4096)).min(1).max(1000).optional(),
    })
    .strict(),
  'review:push': z.object({ projectId: z.uuid(), worktreePath: absolutePath }).strict(),
  'review:pr': z.object({ projectId: z.uuid(), worktreePath: absolutePath }).strict(),
  'review:comments': z.object({ projectId: z.uuid(), worktreePath: absolutePath }).strict(),
  'review:addComment': z.object({
    projectId: z.uuid(), worktreePath: absolutePath,
    path: z.string().min(1).max(4096), line: z.number().int().positive(),
    body: z.string().trim().min(1).max(4000),
  }).strict(),
  'review:sendComments': z.object({
    projectId: z.uuid(), worktreePath: absolutePath, sessionId: z.uuid(),
  }).strict(),
  'review:createPr': z.object({
    projectId: z.uuid(),
    worktreePath: absolutePath,
    branch: z.string().min(1).max(4096),
    title: z.string().trim().min(1).max(256),
    body: z.string().max(20_000),
  }).strict(),
  'review:file': z
    .object({
      projectId: z.uuid(),
      worktreePath: absolutePath,
      mergeBase: z.string().regex(/^[0-9a-f]{40,64}$/, 'hash git attendu'),
      file: z
        .object({
          status: z.enum(['added', 'modified', 'deleted', 'renamed']),
          path: z.string().min(1).max(4096),
          oldPath: z.string().min(1).max(4096).optional(),
        })
        .strict(),
    })
    .strict(),
  'tasks:queue': z.strictObject({}),
  'tasks:dispatchFailures': z.object({ projectId: z.uuid() }).strict(),
  'tasks:reorderQueue': z.strictObject({ id: taskId, direction: z.union([z.literal(-1), z.literal(1)]) }),
  'settings:setAgentConcurrency': z.strictObject({ max: agentConcurrency }),
  'tasks:dispatch': z.strictObject({ projectId: z.uuid(), id: taskId, agent: agentKind }),
  'tasks:list': z.object({ projectId: z.uuid() }).strict(),
  'tasks:create': z.object({ projectId: z.uuid(), ...taskDraft }).strict(),
  'tasks:update': z.object({ projectId: z.uuid(), id: taskId, ...taskDraft }).strict(),
  'tasks:move': z.object({ projectId: z.uuid(), id: taskId, status: z.enum(taskStatuses) }).strict(),
  // Importe ou met à jour les issues GitHub du projet (via `gh`).
  'tasks:importIssues': z.object({ projectId: z.uuid() }).strict(),
} satisfies Record<string, z.ZodType>

export type TaskStatus = (typeof taskStatuses)[number]
export type Task = {
  id: number
  title: string
  body: string
  status: TaskStatus
  issueNumber: number | null // issue GitHub importée, sinon null
  issueUrl: string | null
}

export type ReviewComment = { id: number; path: string; line: number; body: string; sentAt: number | null }
export type PullRequestCheck = { name: string; bucket: 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel' }
export type PullRequestContext =
  | { kind: 'unavailable'; message: string }
  | { kind: 'draft'; branch: string; title: string; body: string }
  | {
      kind: 'existing'
      number: number
      title: string
      url: string
      state: 'OPEN' | 'CLOSED' | 'MERGED'
      checks: PullRequestCheck[]
    }

export type AppInfo = { name: string; version: string; electron: string; node: string }
export type Project = { id: string; path: string; name: string; addedAt: number }
// Résultat d'un ajout par sélecteur : projets ajoutés et chemins refusés (avec la raison).
export type KdePalette = {
  background?: string
  foreground?: string
  accent?: string
  scheme?: 'light' | 'dark'
}

export type Worktree = { path: string; branch: string | null; main: boolean }
export type GitStatus = {
  branch: string | null
  shortSha: string | null
  modified: number
  staged: number
  untracked: number
  ahead: number | null
  behind: number | null
}
export type AgentState = 'starting' | 'working' | 'waiting' | 'done' | 'error'
export type AgentSession = {
  id: string
  agent: IpcRequest<'agents:start'>['agent']
  cwd: string
  state: AgentState
  terminalId: string | null // null : pas de terminal ouvert dans cette exécution de l'appli
  updatedAt: number
}
// Le volet garde sa sortie même si le processus est déjà terminé.
export type QuickAgentStarted = Omit<AgentSession, 'terminalId'> & { terminalId: string }
// Poussé sur le canal `agent:event` à la fenêtre qui a lancé l'agent.
export type AgentDesktopEvent = { type: 'show-terminal'; terminalId: string } | { type: 'play-sound' }
export type TaskQueueItem = { id: number; projectId: string; title: string; agent: AgentSession['agent'] }
export type TaskQueue = { limit: number; pending: TaskQueueItem[] }
export type TasksChanged = { projectId?: string; error?: string; queue: TaskQueue }
export type TaskAgentStarted = { session: AgentSession; terminalId: string; branch: string }
export type AgentEvent = { sessionId: string; terminalId: string; state: AgentState }
export type ChangedFile = {
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  path: string
  oldPath?: string
}
export type PickResult = { added: Project[]; rejected: { path: string; reason: string }[] }
export type OrcaImport = {
  repos: { path: string; name: string; color: string | null }[]
  worktrees: { repoPath: string; path: string; name: string }[]
  workspaceDir: string | null
  warnings: string[]
}

interface IpcResponses {
  'app:info': AppInfo
  'projects:list': Project[]
  'projects:add': Project
  'projects:remove': null
  'projects:removeChecked': { removed: boolean; taskCount: number }
  'projects:pick': PickResult
  'projects:orcaPreview': OrcaImport | null
  'projects:orcaImport': PickResult & { activeWorktree: string | null }
  'projects:orcaDismiss': null
  'worktrees:list': Worktree[]
  'worktrees:status': { path: string; status: GitStatus | null }[]
  'worktrees:snapshot': (Worktree & { status: GitStatus | null })[]
  'worktrees:create': string
  'worktrees:createFromIssue': string
  'worktrees:remove': { removed: boolean; dirtyFiles: number }
  'terminal:create': { pid: number }
  'terminal:write': null
  'terminal:resize': null
  'terminal:kill': null
  'terminal:attach': { data: string; offset: number }
  'terminal:ack': null
  'terminal:workspace': { layout: TerminalLayout; livePanes: string[]; historyPanes: string[] }
  'terminal:saveLayout': null
  'terminal:loadHistory': TerminalHistory | null
  'terminal:saveHistory': null
  'terminal:historyFlushed': null
  'shell:kdePalette': KdePalette
  'shell:openUrl': null
  'agents:start': AgentSession
  'agents:resume': AgentSession
  'agents:list': AgentSession[]
  'review:changes': { base: string; mergeBase: string; files: ChangedFile[] }
  'review:comparison': { base: string; mergeBase: string; files: ChangedFile[]; head: string; headFiles: string[] }
  'review:file': { binary: boolean; before: string; after: string }
  'review:commit': { sha: string }
  'review:push': { output: string }
  'review:pr': PullRequestContext
  'review:comments': ReviewComment[]
  'review:addComment': ReviewComment[]
  'review:sendComments': ReviewComment[]
  'review:createPr': { url: string }
  'tasks:queue': TaskQueue
  'tasks:dispatchFailures': { id: number; message: string }[]
  'tasks:reorderQueue': TaskQueue
  'settings:setAgentConcurrency': TaskQueue
  'tasks:dispatch': Task[]
  'tasks:list': Task[]
  'tasks:create': Task[]
  'tasks:update': Task[]
  'tasks:move': Task[]
  'tasks:importIssues': Task[]
  'diagnostics:report': string
  'settings:get': Settings
  'settings:set': null
}

export type IpcChannel = keyof typeof ipcRequestSchemas
export type IpcRequest<C extends IpcChannel> = z.input<(typeof ipcRequestSchemas)[C]>
export type IpcResponse<C extends IpcChannel> = IpcResponses[C]

// Événements poussés par le main vers le renderer, sur le canal `terminal:event`.
export type TerminalEvent =
  // offset : position dans le flux du terminal à la fin de ce morceau (voir terminal:attach).
  | { type: 'data'; id: string; data: string; offset: number }
  | { type: 'exit'; id: string; exitCode: number; signal: number | null }
  | { type: 'error'; id: string; message: string }
  // Le pty-host a planté et redémarré : tous les terminaux ouverts sont perdus.
  | { type: 'host-restarted' }
