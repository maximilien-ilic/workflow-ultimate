import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcChannel, IpcRequest, IpcResponse } from '../shared/ipc'

const api = {
  invoke: <C extends IpcChannel>(channel: C, req: IpcRequest<C>): Promise<IpcResponse<C>> =>
    ipcRenderer.invoke(channel, req),
  // Chemin local d'un fichier ou dossier déposé (glisser-déposer) ; chaîne vide s'il n'en a pas.
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
}
export type WuApi = typeof api

contextBridge.exposeInMainWorld('wu', api)
