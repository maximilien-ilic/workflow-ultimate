import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { lstat, open, readlink } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { gitEnv, runGit } from '../projects/git-env'

const exec = promisify(execFile)

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed'
export type ChangedFile = { status: FileStatus; path: string; oldPath?: string }

const statuses: Record<string, FileStatus> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  T: 'modified',
}

// Sortie de `git diff --name-status -z -M` : statut puis chemin(s), séparés par NUL.
export function parseNameStatus(raw: string): ChangedFile[] {
  const fields = raw.split('\0')
  const files: ChangedFile[] = []
  for (let i = 0; i < fields.length - 1;) {
    const code = fields[i++] ?? ''
    const status = statuses[code[0] ?? '']
    if (code[0] === 'R' || code[0] === 'C') {
      const oldPath = fields[i++] ?? ''
      const path = fields[i++] ?? ''
      files.push(code[0] === 'R' ? { status: 'renamed', path, oldPath } : { status: 'added', path })
    } else if (status) files.push({ status, path: fields[i++] ?? '' })
    else i++ // statut inconnu (U, X…) : chemin ignoré
  }
  return files
}

// Branche de base : celle de origin/HEAD si elle existe, sinon main, sinon master.
async function baseBranch(repo: string): Promise<string> {
  const remoteHead = await runGit(repo, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']).catch(
    () => '',
  )
  const candidates = [remoteHead, 'refs/heads/main', 'refs/heads/master'].filter(Boolean)
  for (const ref of candidates) {
    const exists = await runGit(repo, ['rev-parse', '--verify', '--quiet', ref]).then(
      () => true,
      () => false,
    )
    if (exists) return ref
  }
  throw new Error('Branche de base introuvable (ni origin/HEAD, ni main, ni master)')
}

// Tout ce qui diffère du point de départ de la branche : commits, changements non commités, nouveaux fichiers.
export async function changedFiles(
  repo: string,
): Promise<{ base: string; mergeBase: string; files: ChangedFile[] }> {
  const baseRef = await baseBranch(repo)
  const mergeBase = await runGit(repo, ['merge-base', 'HEAD', baseRef])
  const base = baseRef.replace(/^refs\/(heads|remotes)\//, '')
  const tracked = parseNameStatus(await runGit(repo, ['diff', '--name-status', '-z', '-M', mergeBase, '--']))
  const byPath = new Map(tracked.map((file) => [file.path, file]))
  const untracked = (await runGit(repo, ['ls-files', '--others', '--exclude-standard', '-z']))
    .split('\0')
    .filter(Boolean)
  for (const path of untracked) {
    const trackedFile = byPath.get(path)
    if (!trackedFile || trackedFile.status === 'deleted') {
      byPath.set(path, { status: trackedFile ? 'modified' : 'added', path })
    }
  }
  const files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
  return { base, mergeBase, files }
}

const MAX_BYTES = 2 * 1024 * 1024

function insideWorktree(repo: string, path: string): string {
  const full = resolve(repo, path)
  const rel = relative(repo, full)
  if (!rel || isAbsolute(path) || rel === '..' || rel.startsWith(`..${sep}`) || rel.split(sep).includes('.git'))
    throw new Error(`${path} : chemin hors du worktree`)
  return rel
}

const looksBinary = (b: Buffer) => b.length > MAX_BYTES || b.subarray(0, 8000).includes(0)

const NO_DIFF = { binary: true, before: '', after: '' }
const GIT_SHOW_TIMEOUT_MS = 10_000
// Marqueur « trop gros » : un tampon dépassant la limite est traité comme un binaire.
const TOO_LARGE = Buffer.alloc(MAX_BYTES + 1)

// Version au point de départ de la branche ; TOO_LARGE si elle dépasse la limite.
async function readBefore(repo: string, mergeBase: string, path: string): Promise<Buffer> {
  try {
    const { stdout } = await exec('git', ['-C', repo, 'show', `${mergeBase}:${path}`], {
      encoding: 'buffer',
      env: gitEnv(),
      timeout: GIT_SHOW_TIMEOUT_MS,
      maxBuffer: MAX_BYTES + 1,
    })
    return stdout
  } catch (error) {
    if ((error as { code?: string }).code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw error
    return TOO_LARGE
  }
}

// Version du dossier de travail. Un lien symbolique est versionné comme sa cible : on montre la cible,
// sans jamais la suivre (elle pourrait pointer hors du worktree).
async function readAfter(repo: string, path: string): Promise<Buffer> {
  const parts = path.split(sep)
  const name = parts.pop()
  const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  let parent = await open(repo, directoryFlags)
  try {
    // Sous Linux, /proc/self/fd ancre chaque ouverture dans un dossier déjà ouvert.
    // Un renommage ou un symlink substitué pendant le parcours ne redirige pas la lecture.
    for (const part of parts) {
      const next = await open(`/proc/self/fd/${parent.fd}/${part}`, directoryFlags).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOTDIR' || error.code === 'ELOOP')
          throw new Error(`${path} : chemin hors du worktree`, { cause: error })
        throw error
      })
      const previous = parent
      parent = next
      await previous.close()
    }
    const fullPath = `/proc/self/fd/${parent.fd}/${name}`
    const info = await lstat(fullPath)
    if (info.isSymbolicLink()) return Buffer.from(await readlink(fullPath))
    if (!info.isFile() || info.size > MAX_BYTES) return TOO_LARGE

    const file = await open(fullPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      if (!(await file.stat()).isFile()) return TOO_LARGE
      const buffer = Buffer.alloc(MAX_BYTES + 1)
      let offset = 0
      while (offset < buffer.length) {
        const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset)
        if (bytesRead === 0) break
        offset += bytesRead
      }
      return buffer.subarray(0, offset)
    } finally {
      await file.close()
    }
  } finally {
    await parent.close()
  }
}

export async function fileVersions(
  repo: string,
  mergeBase: string,
  file: ChangedFile,
): Promise<{ binary: boolean; before: string; after: string }> {
  const afterPath = insideWorktree(repo, file.path)
  const beforePath = file.oldPath ?? file.path
  insideWorktree(repo, beforePath) // refuse aussi un ancien chemin qui sortirait du worktree
  const before = file.status === 'added' ? Buffer.alloc(0) : await readBefore(repo, mergeBase, beforePath)
  const after = file.status === 'deleted' ? Buffer.alloc(0) : await readAfter(repo, afterPath)
  // Binaire ou trop gros : rien n'est envoyé à l'éditeur de diff.
  if (looksBinary(before) || looksBinary(after)) return NO_DIFF
  return { binary: false, before: before.toString('utf8'), after: after.toString('utf8') }
}
