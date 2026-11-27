import console from 'node:console'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron } from '@playwright/test'

const launchCount = 5
const targetMs = 1_500
const durations = []
const root = mkdtempSync(join(tmpdir(), 'wu-startup-'))

try {
  for (let run = 0; run < launchCount; run++) {
    const profile = join(root, String(run))
    const start = performance.now()
    const app = await _electron.launch({
      args: ['out/main/index.js', '--user-data-dir=' + profile],
      env: {
        ...process.env,
        XDG_CONFIG_HOME: join(profile, 'config'),
        XDG_DATA_HOME: join(profile, 'data'),
      },
    })
    try {
      const page = await app.firstWindow()
      await page.getByRole('heading', { name: 'Workflow Ultimate', exact: true }).waitFor({ state: 'visible' })
      await page.getByText(/^v.+ · Electron .+ · Node /).waitFor({ state: 'visible' })
      durations.push(Math.round(performance.now() - start))
    } finally {
      await app.close()
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}

const median = durations.toSorted((a, b) => a - b)[Math.floor(launchCount / 2)]
console.log(`Processus Electron et profils neufs, cache système conservé (${process.env.XDG_SESSION_TYPE ?? process.platform})`)
console.log(`Mesures en ms : ${durations.join(', ')}. Médiane : ${median} ms, objectif : < ${targetMs} ms.`)
if (median >= targetMs) process.exitCode = 1
