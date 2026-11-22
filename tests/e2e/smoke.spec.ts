import { _electron, expect, test } from '@playwright/test'

test('opens the Workflow Ultimate window', async () => {
  const app = await _electron.launch({ args: ['out/main/index.js'] })

  try {
    const window = await app.firstWindow()
    await expect(window.getByRole('heading', { name: 'Workflow Ultimate', exact: true })).toBeVisible()
    // La version vient du main par IPC : on vérifie l'aller-retour, pas seulement le HTML statique.
    await expect(window.getByText(/^v\d+\.\d+\.\d+ · Electron \d+/)).toBeVisible()
  } finally {
    await app.close()
  }
})
