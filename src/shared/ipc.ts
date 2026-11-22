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
  'settings:get': z.object({}).strict(),
  'settings:set': settingsSchema,
  'terminal:create': z.object({ id: z.uuid(), cwd: absolutePath, cols: dimension, rows: dimension }).strict(),
  'terminal:write': z.object({ id: z.uuid(), data: z.string().max(65_536) }).strict(),
  'terminal:resize': z.object({ id: z.uuid(), cols: dimension, rows: dimension }).strict(),
  'terminal:kill': z.object({ id: z.uuid() }).strict(),
  // Renvoie la sortie déjà produite, puis le flux reprend en direct (après un rechargement du renderer).
  'terminal:attach': z.object({ id: z.uuid() }).strict(),
  // Accusé de réception : nombre de caractères affichés par le renderer (contrôle de flux).
  'terminal:ack': z.object({ id: z.uuid(), chars: z.number().int().min(0).max(10_000_000) }).strict(),
} satisfies Record<string, z.ZodType>

export type AppInfo = { name: string; version: string; electron: string; node: string }
export type Project = { id: string; path: string; name: string; addedAt: number }
// Résultat d'un ajout par sélecteur : projets ajoutés et chemins refusés (avec la raison).
export type PickResult = { added: Project[]; rejected: { path: string; reason: string }[] }

interface IpcResponses {
  'app:info': AppInfo
  'projects:list': Project[]
  'projects:add': Project
  'projects:remove': null
  'projects:pick': PickResult
  'terminal:create': null
  'terminal:write': null
  'terminal:resize': null
  'terminal:kill': null
  'terminal:attach': string
  'terminal:ack': null
  'settings:get': Settings
  'settings:set': null
}

export type IpcChannel = keyof typeof ipcRequestSchemas
export type IpcRequest<C extends IpcChannel> = z.input<(typeof ipcRequestSchemas)[C]>
export type IpcResponse<C extends IpcChannel> = IpcResponses[C]

// Événements poussés par le main vers le renderer, sur le canal `terminal:event`.
export type TerminalEvent =
  | { type: 'data'; id: string; data: string }
  | { type: 'exit'; id: string; exitCode: number; signal: number | null }
  | { type: 'error'; id: string; message: string }
  // Le pty-host a planté et redémarré : tous les terminaux ouverts sont perdus.
  | { type: 'host-restarted' }
