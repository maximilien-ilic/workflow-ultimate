import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentSocketPath, startAgentSocket, type AgentSocket } from './socket'

const exec = promisify(execFile)
const notify = resolve('resources/wu-notify')

describe('agent events socket', () => {
  let directory: string
  let path: string
  let server: AgentSocket | undefined
  const sessionId = randomUUID()
  const onEvent = vi.fn()
  const warn = vi.fn()
  const start = () =>
    startAgentSocket({
      path,
      sessionAgent: (id) => (id === sessionId ? 'claude-code' : undefined),
      onEvent,
      warn,
    })
  const line = JSON.stringify({ sessionId, agent: 'claude-code', event: { type: 'needs-input' }, ts: 25 })
  const hookEnv = () => ({ ...process.env, WU_SESSION_ID: sessionId, WU_AGENT_SOCKET: path })

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'wu-agent-socket-'))
    path = join(directory, 'agent.sock')
    server = undefined
    onEvent.mockClear()
    warn.mockClear()
  })

  afterEach(async () => {
    await server?.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('utilise XDG_RUNTIME_DIR s’il existe, sinon le dossier d’état', async () => {
    const runtime = join(directory, 'run')
    const state = join(directory, 'state')
    const env = { XDG_RUNTIME_DIR: runtime, XDG_STATE_HOME: state }
    expect(await agentSocketPath(env, directory)).toBe(join(state, 'workflow-ultimate/agent.sock'))
    mkdirSync(runtime)
    expect(await agentSocketPath(env, directory)).toBe(join(runtime, 'workflow-ultimate.sock'))
    expect(await agentSocketPath({}, directory)).toBe(
      join(directory, '.local/state/workflow-ultimate/agent.sock'),
    )
  })

  it('cadre les lignes fragmentées et continue après une ligne trop longue, invalide ou inconnue', async () => {
    server = await start()
    expect(statSync(path).mode & 0o777).toBe(0o600)
    const client = createConnection(path)
    try {
      await once(client, 'connect')
      client.write(line.slice(0, 40))
      client.write(line.slice(40) + '\n')
      client.write('x'.repeat(64 * 1024))
      client.write('x\n\n')
      client.write(
        JSON.stringify({ sessionId: randomUUID(), agent: 'codex', event: { type: 'error' }, ts: 25 }) + '\n',
      )
      client.write(line.replace('claude-code', 'codex') + '\n')
      client.write(line.replace('needs-input', 'bad') + '\n')
      client.write(line + '\n')
      await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(2))
      expect(onEvent.mock.calls).toEqual([[JSON.parse(line)], [JSON.parse(line)]])
      expect(warn).toHaveBeenCalledTimes(5)
    } finally {
      client.destroy()
    }
  })

  it('ne remplace jamais un socket en écoute', async () => {
    server = await start()
    const live = statSync(path)
    await expect(start()).rejects.toThrow(/utilisé/)
    expect(statSync(path).ino).toBe(live.ino)
    await exec(notify, ['claude-code', 'turn-finished'], { env: hookEnv(), timeout: 2500 })
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledOnce())
  })

  it('ne supprime jamais un fichier ordinaire', async () => {
    writeFileSync(path, 'keep')
    await expect(start()).rejects.toThrow(/socket/)
    expect(statSync(path).isFile()).toBe(true)
  })

  it('réoccupe le socket laissé par un processus arrêté', async () => {
    const child = spawn(
      process.execPath,
      ['-e', 'require("node:net").createServer().listen(process.argv[1], () => console.log("ready"))', path],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    try {
      await once(child.stdout, 'data')
    } finally {
      const stopped = once(child, 'exit')
      child.kill('SIGKILL')
      await stopped
    }
    expect(statSync(path).isSocket()).toBe(true)
    server = await start()
    const result = await exec(notify, ['claude-code', 'needs-input'], { env: hookEnv(), timeout: 2500 })
    expect(result).toEqual({ stdout: '', stderr: '' })
    await vi.waitFor(() =>
      expect(onEvent).toHaveBeenCalledWith({
        sessionId,
        agent: 'claude-code',
        event: { type: 'needs-input' },
        ts: expect.any(Number),
      }),
    )
  })

  it('le hook reste silencieux et réussit quand le socket est absent', async () => {
    await expect(
      exec(notify, ['claude-code', 'needs-input'], { env: hookEnv(), timeout: 2200 }),
    ).resolves.toEqual({
      stdout: '',
      stderr: '',
    })
  })

  it('extrait uniquement thread-id du JSON ajouté par Codex', async () => {
    server = await startAgentSocket({
      path,
      sessionAgent: (id) => (id === sessionId ? 'codex' : undefined),
      onEvent,
      warn,
    })
    const externalId = '019a0000-0000-7000-8000-000000000001'
    const payload = {
      type: 'agent-turn-complete',
      'thread-id': externalId,
      'input-messages': ['secret-test'],
    }
    await exec(notify, ['codex', 'turn-finished', JSON.stringify(payload)], { env: hookEnv(), timeout: 2200 })
    await vi.waitFor(() =>
      expect(onEvent).toHaveBeenCalledExactlyOnceWith({
        sessionId,
        agent: 'codex',
        event: { type: 'turn-finished' },
        externalId,
        ts: expect.any(Number),
      }),
    )

    await exec(
      notify,
      ['codex', 'turn-finished', JSON.stringify({ ...payload, 'thread-id': 'not-a-uuid' })],
      {
        env: hookEnv(),
        timeout: 2200,
      },
    )
    await vi.waitFor(() =>
      expect(onEvent).toHaveBeenNthCalledWith(2, {
        sessionId,
        agent: 'codex',
        event: { type: 'turn-finished' },
        ts: expect.any(Number),
      }),
    )
  })
})
