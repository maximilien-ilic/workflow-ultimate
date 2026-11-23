import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcRequestSchemas } from '../../../shared/ipc'
import { buildDiagnosticsReport } from './diagnostics'

vi.mock('electron', () => ({
  app: { getVersion: () => '0.1.2' },
}))

vi.mock('./global-shortcuts', () => ({
  globalShortcutStatus: () => ({ state: 'unavailable', message: 'Portail indisponible.' }),
}))

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'wu-diagnostics-test-'))
  vi.stubEnv('HOME', directory)
  vi.stubEnv('PATH', directory)
  vi.stubEnv('XDG_CONFIG_HOME', join(directory, 'config'))
  vi.stubEnv('XDG_DATA_HOME', join(directory, 'data'))
  vi.stubEnv('XDG_STATE_HOME', join(directory, 'state'))
  vi.stubEnv('XDG_RUNTIME_DIR', join(directory, 'missing'))
  vi.stubEnv('GITHUB_TOKEN', 'fixture-private-environment')
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(directory, { recursive: true, force: true })
})

describe('Diagnostic', () => {
  it('présente les chemins abrégés et uniquement les versions reconnues des CLI', async () => {
    function fixture(name: string, script: string) {
      writeFileSync(join(directory, name), `#!/bin/sh\n${script}\n`, { mode: 0o700 })
    }
    fixture('claude', "echo '2.1.329 (Claude Code)'; echo 'fixture-private-stdout'")
    fixture('codex', "echo 'codex-cli 0.168.0'; echo 'fixture-private-stderr' >&2")
    fixture('git', "echo 'git version fixture-unparseable-version'")

    const report = await buildDiagnosticsReport()
    expect(report).toContain('Workflow Ultimate 0.1.2')
    expect(report).toContain('Configuration : ~/config/workflow-ultimate')
    expect(report).toContain('Données : ~/data/workflow-ultimate')
    expect(report).toContain('Journaux : ~/state/workflow-ultimate/logs')
    expect(report).toContain('Socket agents : ~/state/workflow-ultimate/agent.sock')
    expect(report).toContain('Portail indisponible.')
    expect(report).toContain('claude : 2.1.329')
    expect(report).toContain('codex : 0.168.0')
    expect(report).toContain('git : version indisponible')
    expect(report).toContain('gh : introuvable')
    expect(report).not.toContain(directory)
    expect(report).not.toContain('fixture-')
  })

  it('refuse les champs inattendus dans la requête IPC', () => {
    expect(ipcRequestSchemas['diagnostics:report'].safeParse({}).success).toBe(true)
    expect(ipcRequestSchemas['diagnostics:report'].safeParse({ path: '/tmp' }).success).toBe(false)
  })
})
