import { describe, expect, it } from 'vitest'
import { claudeArgs, claudeHookSettings, shellQuote } from './claude-code'

const notify = { node: '/opt/Workflow Ultimate/workflow-ultimate', script: '/opt/res/wu-notify' }
const id = '3b241101-e2bb-4255-8caf-4136c566a962'

describe('shellQuote', () => {
  it('protège espaces et apostrophes', () => {
    expect(shellQuote("/opt/l'app x/bin")).toBe(`'/opt/l'\\''app x/bin'`)
  })
})

describe('claudeHookSettings', () => {
  it('branche UserPromptSubmit, Notification et Stop sur wu-notify via le Node embarqué', () => {
    const settings = claudeHookSettings(notify)
    const command = (event: string) => settings.hooks[event]?.[0]?.hooks[0]?.command
    expect(Object.keys(settings.hooks)).toEqual(['UserPromptSubmit', 'Notification', 'Stop'])
    expect(command('Stop')).toBe(
      `ELECTRON_RUN_AS_NODE=1 '/opt/Workflow Ultimate/workflow-ultimate' '/opt/res/wu-notify' claude-code turn-finished`,
    )
    expect(command('Notification')).toContain(' needs-input')
    expect(command('UserPromptSubmit')).toContain(' prompt-submitted')
  })
})

describe('claudeArgs', () => {
  it('nouvelle session : impose notre id de session et passe le prompt initial', () => {
    const args = claudeArgs({ sessionId: id, resume: false, prompt: 'Implémente #12', notify })
    expect(args.slice(0, 2)).toEqual(['--session-id', id])
    expect(args).toContain('--settings')
    expect(JSON.parse(args[args.indexOf('--settings') + 1]!)).toHaveProperty('hooks.Stop')
    expect(args.at(-1)).toBe('Implémente #12')
  })

  it('reprise : --resume avec le même id, sans prompt', () => {
    const args = claudeArgs({ sessionId: id, resume: true, notify })
    expect(args.slice(0, 2)).toEqual(['--resume', id])
    expect(args).not.toContain('--session-id')
  })

  it("n'active jamais le contournement des permissions", () => {
    const args = claudeArgs({
      sessionId: id,
      resume: false,
      prompt: '--dangerously-skip-permissions',
      notify,
    })
    // Le texte n'apparaît qu'en dernier, après `--` : Claude le lit comme un prompt, jamais comme une option.
    expect(args.indexOf('--dangerously-skip-permissions')).toBe(args.length - 1)
    expect(args.at(-2)).toBe('--')
  })
})
