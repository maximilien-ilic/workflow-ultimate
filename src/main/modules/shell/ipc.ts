import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { ipcRequestSchemas, type IpcChannel, type IpcResponse } from '../../../shared/ipc'

type Handler<C extends IpcChannel> = (
  req: z.output<(typeof ipcRequestSchemas)[C]>,
) => IpcResponse<C> | Promise<IpcResponse<C>>

export class IpcValidationError extends Error {
  constructor(channel: IpcChannel, details: string) {
    super(`Requête IPC invalide sur « ${channel} » : ${details}`)
    this.name = 'IpcValidationError'
  }
}

// Le renderer n'est pas de confiance : chaque requête est validée avant d'atteindre le handler.
export function validated<C extends IpcChannel>(channel: C, fn: Handler<C>) {
  const schema: z.ZodType = ipcRequestSchemas[channel]
  return async (_event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResponse<C>> => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) throw new IpcValidationError(channel, z.prettifyError(parsed.error))
    // Le schéma est celui du canal C : le cast redonne à TypeScript ce lien qu'il perd avec un générique.
    return fn(parsed.data as z.output<(typeof ipcRequestSchemas)[C]>)
  }
}

export function handle<C extends IpcChannel>(channel: C, fn: Handler<C>): void {
  ipcMain.handle(channel, validated(channel, fn))
}
