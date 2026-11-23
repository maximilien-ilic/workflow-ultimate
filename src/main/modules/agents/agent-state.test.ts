import { describe, expect, it } from 'vitest'
import { transitionAgent, type AgentEvent, type AgentState } from './state'

const cases = [
  ['starting', 'prompt-submitted', 'working'],
  ['starting', 'needs-input', 'waiting'],
  ['starting', 'turn-finished', 'done'],
  ['starting', 'error', 'error'],
  ['working', 'needs-input', 'waiting'],
  ['working', 'turn-finished', 'done'],
  ['working', 'error', 'error'],
  ['waiting', 'prompt-submitted', 'working'],
  ['waiting', 'turn-finished', 'done'],
  ['waiting', 'error', 'error'],
  ['done', 'prompt-submitted', 'working'],
  ['done', 'error', 'error'],
] as const satisfies readonly (readonly [AgentState, AgentEvent['type'], AgentState])[]

describe('transitionAgent', () => {
  it.each(cases)('%s + %s → %s', (state, type, next) => {
    expect(transitionAgent(state, { type })).toEqual({ state: next, ignoredReason: null })
  })

  it.each(['starting', 'working', 'waiting', 'done'] as const)(
    '%s suit le code de sortie du PTY',
    (state) => {
      expect(transitionAgent(state, { type: 'pty-exit', code: 0 })).toEqual({
        state: 'done',
        ignoredReason: null,
      })
      for (const code of [1, 137, null]) {
        expect(transitionAgent(state, { type: 'pty-exit', code })).toEqual({
          state: 'error',
          ignoredReason: null,
        })
      }
    },
  )

  it.each([
    ['working', { type: 'prompt-submitted' }],
    ['waiting', { type: 'needs-input' }],
    ['done', { type: 'needs-input' }],
    ['done', { type: 'turn-finished' }],
    ['error', { type: 'prompt-submitted' }],
    ['error', { type: 'turn-finished' }],
    ['error', { type: 'pty-exit', code: 0 }],
  ] as const satisfies readonly (readonly [AgentState, AgentEvent])[])(
    'ignore %j + %j avec une raison',
    (state, event) => {
      const result = transitionAgent(state, event)
      expect(result.state).toBe(state)
      expect(result.ignoredReason).toContain(event.type)
      expect(result.ignoredReason).toContain(state)
    },
  )
})
