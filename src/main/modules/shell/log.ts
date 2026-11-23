import { appendFileSync, closeSync, constants, lstatSync, mkdirSync, openSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { formatWithOptions } from 'node:util'
import { appDirectory } from './paths'

const archives = 4

export function logDirectory(): string {
  return join(appDirectory('state'), 'logs')
}

export function installMainLogging(directory = logDirectory(), maxBytes = 1024 * 1024): () => void {
  const original = { warn: console.warn, error: console.error }
  const file = join(directory, 'main.log')
  let writeFailed = false

  function write(level: 'warn' | 'error', args: unknown[]) {
    original[level].apply(console, args)
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      const message = formatWithOptions({ colors: false, depth: 3, maxStringLength: 4_000 }, ...args)
      const raw = Buffer.from(`${new Date().toISOString()} ${level.toUpperCase()} ${message}\n`)
      const line =
        raw.length <= maxBytes
          ? raw
          : Buffer.from(new StringDecoder('utf8').write(raw.subarray(0, maxBytes - 1)) + '\n')
      const current = lstatSync(file, { throwIfNoEntry: false })
      if (current && !current.isFile()) throw new Error('Journal invalide')
      if (current && current.size + line.length > maxBytes) {
        for (let index = archives; index >= 1; index--) {
          const from = index === 1 ? file : `${file}.${index - 1}`
          try {
            renameSync(from, `${file}.${index}`)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          }
        }
      }
      const output = openSync(
        file,
        constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW,
        0o600,
      )
      try {
        appendFileSync(output, line)
      } finally {
        closeSync(output)
      }
      writeFailed = false
    } catch {
      if (!writeFailed) original.warn.call(console, 'Écriture du journal local impossible.')
      writeFailed = true
    }
  }

  console.warn = (...args: unknown[]) => write('warn', args)
  console.error = (...args: unknown[]) => write('error', args)
  return () => {
    console.warn = original.warn
    console.error = original.error
  }
}
