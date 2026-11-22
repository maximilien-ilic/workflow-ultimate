import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron, expect, test } from '@playwright/test'

test('opens the Workflow Ultimate window', async () => {
  // Dossiers isolés : jamais la vraie config de l'utilisateur, ni son verrou d'instance unique.
  const dir = mkdtempSync(join(tmpdir(), 'wu-smoke-'))
  const app = await _electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data') },
  })

  try {
    const window = await app.firstWindow()
    await expect(window.getByRole('heading', { name: 'Workflow Ultimate', exact: true })).toBeVisible()
    // La version vient du main par IPC : on vérifie l'aller-retour, pas seulement le HTML statique.
    await expect(window.getByText(/^v\d+\.\d+\.\d+ · Electron \d+/)).toBeVisible()
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
