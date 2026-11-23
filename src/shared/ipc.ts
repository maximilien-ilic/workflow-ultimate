import { z } from 'zod'
import { settingsSchema, type Settings } from './settings'

// Contrat unique main ↔ renderer. Pas d'import Node ni DOM ici.
// Ajouter un canal = un schéma de requête + un type de réponse.
const absolutePath = z.string().startsWith('/', 'chemin absolu attendu').max(4096)

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
} satisfies Record<string, z.ZodType>

export type AppInfo = { name: string; version: string; electron: string; node: string }
export type Project = { id: string; path: string; name: string; addedAt: number }
// Résultat d'un ajout par sélecteur : projets ajoutés et chemins refusés (avec la raison).
export type Worktree = { path: string; branch: string | null; main: boolean }
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
  'diagnostics:report': string
  'settings:get': Settings
  'settings:set': null
}

export type IpcChannel = keyof typeof ipcRequestSchemas
export type IpcRequest<C extends IpcChannel> = z.input<(typeof ipcRequestSchemas)[C]>
export type IpcResponse<C extends IpcChannel> = IpcResponses[C]
