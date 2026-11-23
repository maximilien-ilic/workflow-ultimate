import { describe, expect, it } from 'vitest'
import { codexArgs } from './codex'

const notify = { node: '/opt/l’appli "test"/workflow-ultimate', script: "/opt/l'app/wu-notify" }
const externalId = '019a0000-0000-7000-8000-000000000001'

describe('codexArgs', () => {
  it('configure notify comme un tableau sans shell en préservant les chemins', () => {
    const args = codexArgs({ notify })
    expect(args[0]).toBe('-c')
    expect(args[1]).toMatch(/^notify=/)
    expect(JSON.parse(args[1]!.slice('notify='.length))).toEqual([
      'env',
      'ELECTRON_RUN_AS_NODE=1',
      notify.node,
      notify.script,
      'codex',
      'turn-finished',
    ])
    expect(args).toHaveLength(2)
  })

  it.each(['--help', '--dangerously-bypass-hook-trust', 'resume', 'ligne 1\nligne 2'])(
    'passe %j comme prompt',
    (prompt) => {
      expect(codexArgs({ notify, prompt }).slice(2)).toEqual(['--', prompt])
    },
  )

  it('reprend uniquement le thread demandé', () => {
    const args = codexArgs({ notify, resumeId: externalId })
    expect(args.slice(2)).toEqual(['resume', externalId])
    expect(args).not.toContain('--last')
  })
})
