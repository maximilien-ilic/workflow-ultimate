import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installMainLogging } from './log'

let directory: string
let restore: (() => void) | undefined

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'wu-log-test-'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  restore?.()
  restore = undefined
  vi.restoreAllMocks()
  rmSync(directory, { recursive: true, force: true })
})

describe('journal du main', () => {
  it('conserve cinq fichiers privés au plus, du plus récent au plus ancien', () => {
    const previousWarn = console.warn
    const logPath = join(directory, 'logs')
    restore = installMainLogging(logPath, 90)
    for (let index = 0; index < 7; index++) console.warn('entrée %d %s', index, 'a'.repeat(22))
    expect(previousWarn).toHaveBeenCalledTimes(7)
    const files = readdirSync(logPath).sort()
    expect(files).toEqual(['main.log', 'main.log.1', 'main.log.2', 'main.log.3', 'main.log.4'])
    for (const [index, file] of files.entries()) {
      expect(readFileSync(join(logPath, file), 'utf8')).toContain(`WARN entrée ${6 - index}`)
      expect(statSync(join(logPath, file)).mode & 0o777).toBe(0o600)
      expect(statSync(join(logPath, file)).size).toBeLessThanOrEqual(90)
    }
    expect(statSync(logPath).mode & 0o777).toBe(0o700)
  })

  it('borne un message plus gros que le fichier et préserve le niveau', () => {
    restore = installMainLogging(directory, 90)
    console.error('é'.repeat(200))
    const log = readFileSync(join(directory, 'main.log'), 'utf8')
    expect(Buffer.byteLength(log)).toBeLessThanOrEqual(90)
    expect(log).toMatch(/ERROR é+.*\n$/)
    expect(log).not.toContain('�')
  })

  it('laisse le main fonctionner lorsque les journaux ne sont pas accessibles', () => {
    const previousWarn = console.warn
    restore = installMainLogging('/dev/null/logs')
    console.error('problème de test')
    console.warn('avertissement de test')
    expect(previousWarn).toHaveBeenCalledTimes(2)
    expect(previousWarn).toHaveBeenCalledWith('avertissement de test')
  })
})
