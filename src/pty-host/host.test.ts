import { describe, expect, it } from 'vitest'
import type { HostEvent } from '../shared/pty-protocol'
import { createHost } from './host'

function setup() {
  const events: HostEvent[] = []
  const host = createHost((e) => events.push(e))
  const output = (id: string) =>
    events.filter((e) => e.type === 'data' && e.id === id).map((e) => (e as { data: string }).data).join('')
  const waitFor = async (check: () => boolean, ms = 5000) => {
    const start = Date.now()
    while (!check()) {
      if (Date.now() - start > ms) throw new Error('délai dépassé, événements : ' + JSON.stringify(events))
      await new Promise((r) => setTimeout(r, 20))
    }
  }
  return { host, events, output, waitFor }
}
const base = { cwd: '/tmp', env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin' }, cols: 80, rows: 24 }

describe('pty-host', () => {
  it('lance une commande, transmet sa sortie puis son code de sortie', async () => {
    const { host, events, output, waitFor } = setup()
    host.handle({ type: 'spawn', id: 't1', file: 'sh', args: ['-c', 'echo bonjour; exit 3'], ...base })
    await waitFor(() => events.some((e) => e.type === 'exit'))
    expect(output('t1')).toContain('bonjour')
    expect(events.at(-1)).toMatchObject({ type: 'exit', id: 't1', exitCode: 3 })
  })

  it('transmet ce qu’on écrit au shell', async () => {
    const { host, output, waitFor } = setup()
    host.handle({ type: 'spawn', id: 't1', file: 'sh', args: [], ...base })
    host.handle({ type: 'write', id: 't1', data: 'echo $((40+2))\n' })
    await waitFor(() => output('t1').includes('42'))
    host.handle({ type: 'kill', id: 't1' })
  })

  it('rejoue la sortie déjà produite, même après la fin du processus', async () => {
    const { host, events, waitFor } = setup()
    host.handle({ type: 'spawn', id: 't1', file: 'sh', args: ['-c', 'echo trace'], ...base })
    await waitFor(() => events.some((e) => e.type === 'exit'))
    host.handle({ type: 'replay', id: 't1' })
    expect(events.at(-1)).toMatchObject({ type: 'replay', id: 't1' })
    expect((events.at(-1) as { data: string }).data).toContain('trace')
  })

  it('signale une erreur au lieu de planter (id en double, id inconnu, dossier introuvable)', async () => {
    const { host, events } = setup()
    host.handle({ type: 'spawn', id: 't1', file: 'sh', args: [], ...base })
    host.handle({ type: 'spawn', id: 't1', file: 'sh', args: [], ...base })
    host.handle({ type: 'write', id: 'inconnu', data: 'x' })
    host.handle({ type: 'spawn', id: 't2', file: 'sh', args: [], ...base, cwd: '/nexiste/pas' })
    const errors = events.filter((e) => e.type === 'error').map((e) => e.id)
    expect(errors).toEqual(['t1', 'inconnu', 't2'])
    host.handle({ type: 'kill', id: 't1' })
  })

  it('pause suspend la sortie, resume la libère', async () => {
    const { host, output, waitFor } = setup()
    host.handle({ type: 'spawn', id: 't1', file: 'sh', args: [], ...base })
    host.handle({ type: 'pause', id: 't1' })
    host.handle({ type: 'write', id: 't1', data: 'echo apres-pause\n' })
    await new Promise((r) => setTimeout(r, 300))
    expect(output('t1')).not.toContain('apres-pause')
    host.handle({ type: 'resume', id: 't1' })
    await waitFor(() => output('t1').includes('apres-pause'))
    host.handle({ type: 'kill', id: 't1' })
  })

  it('kill termine le processus et libère le terminal', async () => {
    const { host, events, waitFor } = setup()
    host.handle({ type: 'spawn', id: 't1', file: 'sh', args: ['-c', 'sleep 30'], ...base })
    host.handle({ type: 'kill', id: 't1' })
    await waitFor(() => events.some((e) => e.type === 'exit'))
    host.handle({ type: 'kill', id: 't1' })
    host.handle({ type: 'replay', id: 't1' })
    expect(events.at(-1)).toMatchObject({ type: 'error', id: 't1' })
  })
})
