import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { constants, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { HostEvent } from '../shared/pty-protocol'
import { createHost } from './host'

function setup() {
  const events: HostEvent[] = []
  const host = createHost((e) => events.push(e))
  const output = (id: string) =>
    events
      .filter((e) => e.type === 'data' && e.id === id)
      .map((e) => (e as { data: string }).data)
      .join('')
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
    expect(events[0]).toMatchObject({ type: 'spawned', id: 't1', pid: expect.any(Number) })
    expect(events.at(-1)).toMatchObject({ type: 'exit', id: 't1', exitCode: 3 })
  })

  it('transmet ce qu’on écrit au shell', async () => {
    const { host, output, waitFor } = setup()
    host.handle({ type: 'spawn', id: 't1', file: 'sh', args: [], ...base })
    host.handle({ type: 'write', id: 't1', data: 'echo $((40+2))\n' })
    await waitFor(() => output('t1').includes('42'))
    host.handle({ type: 'kill', id: 't1' })
  })

  it('rejette un reçu si le PTY ferme avant la fin d’une écriture en attente', async () => {
    const { host, events, output, waitFor } = setup()
    host.handle({
      type: 'spawn',
      id: 't1',
      file: process.execPath,
      args: ['-e', `
        process.stdin.setRawMode(true)
        process.stdin.once('data', () => {
          process.stdin.pause()
          console.log('début reçu')
        })
        console.log('prêt')
        setInterval(() => {}, 1000)
      `],
      ...base,
    })
    try {
      await waitFor(() => output('t1').includes('prêt'))
      const receipt = 'reçu-interrompu'
      host.handle({ type: 'write', id: 't1', data: '界'.repeat(256 * 1024), receipt })
      await waitFor(() => output('t1').includes('début reçu'))
      expect(events.some((event) => event.type === 'written' && event.receipt === receipt)).toBe(false)
      host.handle({ type: 'kill', id: 't1' })
      await waitFor(() => events.some((event) => event.type === 'closed'))
      expect(events).toContainEqual(expect.objectContaining({ type: 'error', request: 'write', receipt }))
      expect(events.some((event) => event.type === 'written' && event.receipt === receipt)).toBe(false)
    } finally {
      if (!events.some((event) => event.type === 'closed')) {
        host.handle({ type: 'kill', id: 't1' })
        await waitFor(() => events.some((event) => event.type === 'closed'))
      }
    }
  })

  it('isole le PTY après un collage partiel expiré et renvoie le lot entier dans un nouveau PTY', async () => {
    const { host, events, output, waitFor } = setup()
    const opening = '\x1b[200~'
    const closing = '\x1b[201~\r'
    const data = opening + '界'.repeat(256 * 1024) + closing
    const hash = createHash('sha256').update(data).digest('hex')
    const spawnReader = (id: string, source: string) =>
      host.handle({ type: 'spawn', id, file: process.execPath, args: ['-e', source], ...base })
    spawnReader('initial', `
      process.stdin.setRawMode(true)
      process.stdin.once('data', (bytes) => {
        if (bytes.toString().startsWith(${JSON.stringify(opening)})) console.log('ouverture reçue')
        process.stdin.pause()
      })
      console.log('prêt')
      setInterval(() => {}, 1000)
    `)
    try {
      await waitFor(() => output('initial').includes('prêt'))
      host.handle({ type: 'write', id: 'initial', data, receipt: 'initial' })
      await waitFor(() => output('initial').includes('ouverture reçue'))
      const failure = () => events.find((event) => event.type === 'error' && event.receipt === 'initial')
      await waitFor(() => Boolean(failure()), 7_000)
      expect(failure()).toMatchObject({ message: expect.stringContaining('nouveau terminal') })
      expect(events.some((event) => event.id === 'initial' && event.type === 'exit')).toBe(false)
      host.handle({ type: 'write', id: 'initial', data, receipt: 'refusé' })
      expect(events.at(-1)).toMatchObject({ type: 'error', receipt: 'refusé' })

      spawnReader('nouveau', `
        const crypto = require('node:crypto')
        process.stdin.setRawMode(true)
        const chunks = []
        let size = 0
        process.stdin.on('data', (bytes) => {
          chunks.push(bytes)
          size += bytes.length
          if (size < ${Buffer.byteLength(data)}) return
          console.log(crypto.createHash('sha256').update(Buffer.concat(chunks)).digest('hex'))
          process.exit(0)
        })
        console.log('prêt')
      `)
      await waitFor(() => output('nouveau').includes('prêt'))
      host.handle({ type: 'write', id: 'nouveau', data, receipt: 'réessai' })
      await waitFor(() => output('nouveau').includes(hash))
      expect(events).toContainEqual({ type: 'written', id: 'nouveau', receipt: 'réessai' })
    } finally {
      host.handle({ type: 'kill', id: 'initial' })
      if (events.some((event) => event.id === 'nouveau' && event.type === 'spawned'))
        host.handle({ type: 'kill', id: 'nouveau' })
    }
  }, 15_000)

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
    const errors = events
      .filter((e) => e.type === 'error')
      .map((e) => [e.id, (e as { request: string }).request])
    expect(errors).toEqual([
      ['t1', 'spawn'],
      ['inconnu', 'write'],
      ['t2', 'spawn'],
    ])
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

  it('une exception pendant une requête devient une erreur du terminal, le host continue', async () => {
    const { host, events, output, waitFor } = setup()
    const locked = mkdtempSync(join(tmpdir(), 'wu-locked-'))
    chmodSync(locked, 0o000) // stat d'un sous-dossier → EACCES (exception, pas ENOENT)
    try {
      host.handle({ type: 'spawn', id: 't1', file: 'sh', args: [], ...base, cwd: join(locked, 'sub') })
    } finally {
      chmodSync(locked, 0o700)
      rmSync(locked, { recursive: true })
    }
    expect(events.at(-1)).toMatchObject({ type: 'error', id: 't1' })
    host.handle({ type: 'spawn', id: 't2', file: 'sh', args: ['-c', 'echo toujours-vivant'], ...base })
    await waitFor(() => output('t2').includes('toujours-vivant'))
  })

  it('numérote la sortie : chaque morceau et le rejeu portent leur position dans le flux', async () => {
    const { host, events, output, waitFor } = setup()
    host.handle({ type: 'spawn', id: 't1', file: 'sh', args: ['-c', 'echo un; echo deux'], ...base })
    await waitFor(() => events.some((e) => e.type === 'exit'))
    const chunks = events.filter((e) => e.type === 'data') as { data: string; offset: number }[]
    let total = 0
    for (const c of chunks) expect(c.offset).toBe((total += c.data.length))
    host.handle({ type: 'replay', id: 't1' })
    expect(events.at(-1)).toMatchObject({ type: 'replay', offset: total, data: output('t1') })
  })

  it('kill sur un terminal déjà terminé le libère aussi, avec confirmation', async () => {
    const { host, events, waitFor } = setup()
    host.handle({ type: 'spawn', id: 't1', file: 'sh', args: ['-c', 'true'], ...base })
    await waitFor(() => events.some((e) => e.type === 'exit'))
    host.handle({ type: 'kill', id: 't1' })
    expect(events.at(-1)).toEqual({ type: 'closed', id: 't1' })
  })

  it('confirme la fermeture d’un lancement expiré dont le PTY est absent', () => {
    const { host, events } = setup()
    const request = { type: 'kill', id: 'absent', expiredSpawn: true } as const
    host.handle(request)
    expect(events).toEqual([{ type: 'closed', id: 'absent' }])
  })

  it('tue un lancement expiré qui ignore SIGHUP avant de confirmer sa fermeture', async () => {
    const { host, events, output, waitFor } = setup()
    host.handle({
      type: 'spawn',
      id: 't1',
      file: process.execPath,
      args: [
        '-e',
        `process.on('SIGHUP', () => {})
        console.log('prêt')
        const fixtureLifetimeMs = 2000
        setTimeout(() => { process.exitCode = 1 }, fixtureLifetimeMs)`,
      ],
      ...base,
    })
    await waitFor(() => output('t1').includes('prêt'))
    const request = { type: 'kill', id: 't1', expiredSpawn: true } as const
    host.handle(request)
    await waitFor(() => events.some((event) => event.type === 'closed'))
    expect(events).toContainEqual({ type: 'exit', id: 't1', exitCode: 0, signal: constants.signals.SIGKILL })
    expect(events.at(-1)).toEqual({ type: 'closed', id: 't1' })
  })

  it('kill termine le processus et libère le terminal', async () => {
    const { host, events, waitFor } = setup()
    host.handle({ type: 'spawn', id: 't1', file: 'sh', args: ['-c', 'sleep 30'], ...base })
    host.handle({ type: 'kill', id: 't1' })
    await waitFor(() => events.some((e) => e.type === 'exit'))
    // La fermeture est confirmée explicitement : le main peut oublier le terminal.
    await waitFor(() => events.some((e) => e.type === 'closed' && e.id === 't1'))
    host.handle({ type: 'kill', id: 't1' })
    host.handle({ type: 'replay', id: 't1' })
    expect(events.at(-1)).toMatchObject({ type: 'error', id: 't1' })
  })
})
