import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { startAgentSocket, type AgentKind, type AgentSocketEvent } from './socket'

const fixture = resolve('tests/fixtures/fake-agent')
const scenarios = [
  ['success', 'claude-code', ['prompt-submitted', 'turn-finished'], 0],
  ['error', 'codex', ['prompt-submitted', 'error'], 1],
  ['question', 'codex', ['prompt-submitted', 'needs-input', 'prompt-submitted', 'turn-finished'], 0],
] as const satisfies readonly (readonly [
  string,
  AgentKind,
  readonly AgentSocketEvent['event']['type'][],
  number,
])[]

describe('fake-agent', () => {
  it.each(scenarios)('simule %s pour %s', async (scenario, agent, expectedEvents, exitCode) => {
    const dir = mkdtempSync(join(tmpdir(), 'wu-fake-agent-'))
    const path = join(dir, 'agent.sock')
    const sessionId = randomUUID()
    const events: AgentSocketEvent[] = []
    const server = await startAgentSocket({
      path,
      sessionAgent: (id) => (id === sessionId ? agent : undefined),
      onEvent: (event) => events.push(event),
    })

    const child = spawn(fixture, [scenario, agent], {
      env: { ...process.env, WU_SESSION_ID: sessionId, WU_AGENT_SOCKET: path },
      stdio: 'pipe',
    })
    const finished = new Promise<number | null>((resolve) => child.once('close', resolve))
    let output = ''
    child.stdout.setEncoding('utf8').on('data', (data: string) => {
      output += data
    })

    try {
      await once(child, 'spawn')
      if (scenario === 'question') {
        await vi.waitFor(() =>
          expect(events.map(({ event }) => event.type)).toEqual(expectedEvents.slice(0, 2)),
        )
        expect(child.exitCode).toBeNull()
        expect(output).toContain('Continuer ?')
        child.stdin.end('oui\n')
      }

      expect(await finished).toBe(exitCode)
      await vi.waitFor(() => expect(events.map(({ event }) => event.type)).toEqual(expectedEvents))
      expect(events).toHaveLength(expectedEvents.length)
      for (const event of events) expect(event).toMatchObject({ sessionId, agent, ts: expect.any(Number) })
      expect(output).toContain(agent)
    } finally {
      if (child.exitCode === null) child.kill()
      await finished
      await server.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
