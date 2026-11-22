import { contextBridge } from 'electron'

// shortcut: expose seulement les versions, le contrat IPC typé arrive avec #4
contextBridge.exposeInMainWorld('wu', {
  versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
})
