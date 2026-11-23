import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { ipcRequestSchemas, type IpcChannel, type IpcResponse } from '../../../shared/ipc'
import { rendererUrl } from './window'

type Handler<C extends IpcChannel> = (
  req: z.output<(typeof ipcRequestSchemas)[C]>,
  event: IpcMainInvokeEvent,
) => IpcResponse<C> | Promise<IpcResponse<C>>

export class IpcValidationError extends Error {
  constructor(channel: IpcChannel, details: string) {
    super(`Requête IPC invalide sur « ${channel} » : ${details}`)
    this.name = 'IpcValidationError'
  }
}

export class IpcForbiddenError extends Error {
  constructor(channel: IpcChannel) {
    super(`Émetteur non autorisé sur « ${channel} »`)
    this.name = 'IpcForbiddenError'
  }
}

// Seul le frame principal qui affiche notre renderer peut parler au main.
export function isTrustedSender(event: IpcMainInvokeEvent, expectedUrl: string): boolean {
  const frame = event.senderFrame
  if (!frame || frame.parent !== null) return false
  const sender = new URL(frame.url)
  const expected = new URL(expectedUrl)
  if (expected.protocol === 'file:') return sender.protocol === 'file:' && sender.pathname === expected.pathname
  return sender.origin === expected.origin
}

// Le renderer n'est pas de confiance : émetteur puis requête sont vérifiés avant d'atteindre le handler.
export function validated<C extends IpcChannel>(
  channel: C,
  fn: Handler<C>,
  trusted: (event: IpcMainInvokeEvent) => boolean,
) {
  const schema: z.ZodType = ipcRequestSchemas[channel]
  return async (event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResponse<C>> => {
    if (!trusted(event)) throw new IpcForbiddenError(channel)
    const parsed = schema.safeParse(raw)
    if (!parsed.success) throw new IpcValidationError(channel, z.prettifyError(parsed.error))
    // Le schéma est celui du canal C : le cast redonne à TypeScript ce lien qu'il perd avec un générique.
    return fn(parsed.data as z.output<(typeof ipcRequestSchemas)[C]>, event)
  }
}

export function handle<C extends IpcChannel>(channel: C, fn: Handler<C>): void {
  ipcMain.handle(
    channel,
    validated(channel, fn, (event) => isTrustedSender(event, rendererUrl())),
  )
}
