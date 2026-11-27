import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AgentDesktopEvent, AgentEvent, IpcChannel, IpcRequest, IpcResponse, TaskAgentStarted, TerminalEvent } from '../shared/ipc'

const api = {
  invoke: <C extends IpcChannel>(channel: C, req: IpcRequest<C>): Promise<IpcResponse<C>> =>
    ipcRenderer.invoke(channel, req),
  // Chemin local d'un fichier ou dossier déposé (glisser-déposer) ; chaîne vide s'il n'en a pas.
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  // Sortie et fin des terminaux, poussées par le main. Renvoie la fonction de désabonnement.
  onTerminalEvent: (listener: (event: TerminalEvent) => void): (() => void) => {
    const wrapped = (_: unknown, event: TerminalEvent) => listener(event)
    ipcRenderer.on('terminal:event', wrapped)
    return () => ipcRenderer.removeListener('terminal:event', wrapped)
  },
  onTerminalHistoryFlush: (listener: () => void): void => {
    ipcRenderer.on('terminal:flush-history', () => listener())
  },
  onAgentDesktopEvent: (listener: (event: AgentDesktopEvent) => void): void => {
    ipcRenderer.on('agents:desktop', (_event, event: AgentDesktopEvent) => listener(event))
  },
  onTaskAgentStarted: (listener: (event: TaskAgentStarted) => void): (() => void) => {
    const wrapped = (_: unknown, event: TaskAgentStarted) => listener(event)
    ipcRenderer.on('tasks:agentStarted', wrapped)
    return () => ipcRenderer.removeListener('tasks:agentStarted', wrapped)
  },
  // Changements d'état des agents lancés par cette fenêtre.
  onAgentEvent: (listener: (event: AgentEvent) => void): (() => void) => {
    const wrapped = (_: unknown, event: AgentEvent) => listener(event)
    ipcRenderer.on('agent:event', wrapped)
    return () => ipcRenderer.removeListener('agent:event', wrapped)
  },
}
export type WuApi = typeof api

contextBridge.exposeInMainWorld('wu', api)
