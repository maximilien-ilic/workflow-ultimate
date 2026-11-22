import { z } from 'zod'

// Contrat unique main ↔ renderer. Pas d'import Node ni DOM ici.
// Ajouter un canal = un schéma de requête + un type de réponse.
export const ipcRequestSchemas = {
  'app:info': z.object({}).strict(),
} satisfies Record<string, z.ZodType>

export type AppInfo = { name: string; version: string; electron: string; node: string }

interface IpcResponses {
  'app:info': AppInfo
}

export type IpcChannel = keyof typeof ipcRequestSchemas
export type IpcRequest<C extends IpcChannel> = z.input<(typeof ipcRequestSchemas)[C]>
export type IpcResponse<C extends IpcChannel> = IpcResponses[C]
