import { z } from 'zod'
import { settingsSchema, type Settings } from './settings'

// Contrat unique main ↔ renderer. Pas d'import Node ni DOM ici.
// Ajouter un canal = un schéma de requête + un type de réponse.
const absolutePath = z.string().startsWith('/', 'chemin absolu attendu').max(4096)
const dimension = z.number().int().min(1).max(1000)

export const ipcRequestSchemas = {
  'app:info': z.object({}).strict(),
  'projects:list': z.object({}).strict(),
  'projects:add': z.object({ path: absolutePath }).strict(),
  'projects:remove': z.object({ id: z.uuid() }).strict(),
  // Ouvre le sélecteur de dossier du système : `repo` ajoute un dépôt, `scan` ajoute tous ceux trouvés dedans.
  'projects:pick': z.object({ mode: z.enum(['repo', 'scan']) }).strict(),
  'diagnostics:report': z.object({}).strict(),
  'settings:get': z.object({}).strict(),
  'settings:set': settingsSchema,
  'worktrees:list': z.object({ projectId: z.uuid() }).strict(),
  'worktrees:create': z
    .object({ projectId: z.uuid(), branch: z.string().min(1).max(200), create: z.boolean() })
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
  // Lien cliqué dans un terminal : ouvert dans le navigateur du système, http(s) seulement.
  'shell:openUrl': z.object({ url: z.url({ protocol: /^https?$/ }).max(4096) }).strict(),
  // Lance l'agent dans un nouveau terminal `terminalId` (le renderer s'y rattache ensuite).
  'agents:start': z
    .object({
      terminalId: z.uuid(),
      cwd: absolutePath,
      agent: z.enum(['claude-code', 'codex']),
      prompt: z.string().max(20_000).optional(),
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
} satisfies Record<string, z.ZodType>

export type AppInfo = { name: string; version: string; electron: string; node: string }
export type Project = { id: string; path: string; name: string; addedAt: number }
// Résultat d'un ajout par sélecteur : projets ajoutés et chemins refusés (avec la raison).
export type Worktree = { path: string; branch: string | null; main: boolean }
export type AgentState = 'starting' | 'working' | 'waiting' | 'done' | 'error'
export type AgentSession = {
  id: string
  agent: IpcRequest<'agents:start'>['agent']
  cwd: string
  state: AgentState
  terminalId: string | null // null : pas de terminal ouvert dans cette exécution de l'appli
  updatedAt: number
}
// Poussé sur le canal `agent:event` à la fenêtre qui a lancé l'agent.
export type AgentEvent = { sessionId: string; terminalId: string; state: AgentState }
export type ChangedFile = {
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  path: string
  oldPath?: string
}
export type PickResult = { added: Project[]; rejected: { path: string; reason: string }[] }

interface IpcResponses {
  'app:info': AppInfo
  'projects:list': Project[]
  'projects:add': Project
  'projects:remove': null
  'projects:pick': PickResult
  'worktrees:list': Worktree[]
  'worktrees:create': string
  'worktrees:createFromIssue': string
  'worktrees:remove': { removed: boolean; dirtyFiles: number }
  'terminal:create': { pid: number }
  'terminal:write': null
  'terminal:resize': null
  'terminal:kill': null
  'terminal:attach': { data: string; offset: number }
  'terminal:ack': null
  'shell:openUrl': null
  'agents:start': AgentSession
  'agents:resume': AgentSession
  'agents:list': AgentSession[]
  'review:changes': { base: string; mergeBase: string; files: ChangedFile[] }
  'review:file': { binary: boolean; before: string; after: string }
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
