import { BrowserWindow, dialog, shell } from 'electron'
import { handle } from './ipc'

// Liens cliqués (Ctrl+clic) dans un terminal. Le texte d'un terminal est arbitraire : refus par défaut.
// Une origine de la liste exacte s'ouvre directement ; toute autre demande une confirmation qui montre
// l'adresse complète. Le schéma IPC n'accepte déjà que http(s), et `handle` vérifie le frame appelant.
export function registerExternalLinks(trustedOrigins: readonly string[]): void {
  handle('shell:openUrl', async ({ url }, event) => {
    if (!trustedOrigins.includes(new URL(url).origin)) {
      const parent = BrowserWindow.fromWebContents(event.sender)
      const options = {
        type: 'question' as const,
        message: 'Ouvrir ce lien dans le navigateur ?',
        detail: url,
        buttons: ['Ouvrir', 'Annuler'],
        defaultId: 1,
        cancelId: 1,
      }
      const { response } = parent
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options)
      if (response !== 0) return null
    }
    await shell.openExternal(url)
    return null
  })
}
