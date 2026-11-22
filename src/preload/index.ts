import { contextBridge, ipcRenderer } from 'electron'
import type { IpcChannel, IpcRequest, IpcResponse } from '../shared/ipc'

const api = {
  invoke: <C extends IpcChannel>(channel: C, req: IpcRequest<C>): Promise<IpcResponse<C>> =>
    ipcRenderer.invoke(channel, req),
}
export type WuApi = typeof api

contextBridge.exposeInMainWorld('wu', api)
