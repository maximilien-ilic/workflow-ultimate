import { describe, expect, it } from 'vitest'
import { parseAction } from './single-instance'

describe('parseAction', () => {
  it.each([
    [['--action', 'window.show'], 'window.show'],
    [['--action=window.show'], 'window.show'],
    [['--inspect=0', '/tmp/app/main.js', '--action', 'a-1.2', '--original-process-start-time=1'], 'a-1.2'],
  ])('lit une action au milieu des arguments de lancement (%j)', (args, action) => {
    expect(parseAction(['/opt/Workflow Ultimate/workflow-ultimate', ...args])).toBe(action)
  })

  it.each([
    [[]],
    [['--action']],
    [['--action=']],
    [['--action', '--enable-logging']],
    [['--action', 'Window.Show']],
    [['--action=window.show;echo']],
    [['--action=window.show\n']],
    [['--other-action=window.show']],
    [['--', '--action', 'window.show']],
  ])('ignore les arguments sans action valide (%j)', (args) => {
    expect(parseAction(['/usr/bin/electron', ...args])).toBeNull()
  })
})
