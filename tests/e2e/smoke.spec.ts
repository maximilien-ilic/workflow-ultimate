import { _electron, expect, test } from '@playwright/test'

test('opens the Workflow Ultimate window', async () => {
  const app = await _electron.launch({ args: ['out/main/index.js'] })

  try {
    const window = await app.firstWindow()
    await expect(window.getByRole('heading', { name: 'Workflow Ultimate', exact: true })).toBeVisible()
  } finally {
    await app.close()
  }
})
