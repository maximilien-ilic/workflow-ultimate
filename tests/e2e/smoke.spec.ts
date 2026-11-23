import { _electron, expect, test } from '@playwright/test'

test('opens the Workflow Ultimate window', async () => {
  const testInfo = test.info()
  const app = await _electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${testInfo.outputPath('profile')}`],
    env: {
      ...process.env,
      XDG_CONFIG_HOME: testInfo.outputPath('config'),
      XDG_DATA_HOME: testInfo.outputPath('data'),
    },
  })

  try {
    const window = await app.firstWindow()
    await expect(window.getByRole('heading', { name: 'Workflow Ultimate', exact: true })).toBeVisible()
  } finally {
    await app.close()
  }
})
