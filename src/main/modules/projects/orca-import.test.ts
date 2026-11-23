import { createHash } from 'node:crypto'
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readOrcaConfig, readOrcaProfile, readSnapshot } from './orca-import'

let configHome: string
beforeEach(() => (configHome = mkdtempSync(join(tmpdir(), 'wu-orca-'))))
afterEach(() => rmSync(configHome, { recursive: true, force: true }))

// Base fictive qui reproduit le schéma d'Orca (aucune donnée réelle).
function makeProfile(
  profile: string,
  docs: Record<string, unknown>,
  raw: Record<string, string> = {},
): string {
  const dir = join(configHome, 'orca/profiles', profile)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'profile-state.db')
  const db = new DatabaseSync(file)
  db.exec(
    'CREATE TABLE profile_state_documents (domain TEXT PRIMARY KEY, payload TEXT, domain_version INTEGER, revision INTEGER, updated_at INTEGER, content_hash TEXT)',
  )
  const insert = db.prepare(
    'INSERT INTO profile_state_documents (domain, payload, domain_version) VALUES (?, ?, 1)',
  )
  for (const [domain, value] of Object.entries(docs)) insert.run(domain, JSON.stringify(value))
  for (const [domain, payload] of Object.entries(raw)) insert.run(domain, payload)
  db.close()
  return file
}

const repos = [
  {
    id: 'r1',
    path: '/home/u/projects/alpha',
    displayName: 'alpha',
    badgeColor: '#ff0000',
    kind: 'git',
    addedAt: 1,
  },
  { id: 'r2', path: '/home/u', displayName: '~', badgeColor: '#737373', kind: 'folder', addedAt: 2 },
  { id: 'r3', path: '/home/u/projects/beta', displayName: 'Beta', kind: 'git', addedAt: 3 },
]
const worktreeMeta = {
  'r1::/home/u/projects/alpha': { displayName: 'alpha' },
  'r1::/home/u/ws/alpha/feat-x': { displayName: 'feat-x' },
  'r3::/home/u/ws/beta/fix': {},
  'inconnu::/home/u/ws/ghost': { displayName: 'ghost' },
}

describe('readOrcaProfile', () => {
  it('extrait les dépôts git, leurs worktrees et le dossier de workspaces', () => {
    const file = makeProfile('local-default', {
      repos,
      worktreeMeta,
      settings: { workspaceDir: '/home/u/ws' },
    })
    expect(readOrcaProfile(file)).toEqual({
      repos: [
        { path: '/home/u/projects/alpha', name: 'alpha', color: '#ff0000' },
        { path: '/home/u/projects/beta', name: 'Beta', color: null },
      ],
      worktrees: [
        { repoPath: '/home/u/projects/alpha', path: '/home/u/ws/alpha/feat-x', name: 'feat-x' },
        { repoPath: '/home/u/projects/beta', path: '/home/u/ws/beta/fix', name: 'fix' },
      ],
      workspaceDir: '/home/u/ws',
      warnings: [],
    })
  })

  it("n'écrit jamais dans la base d'Orca", () => {
    const file = makeProfile('p', { repos, worktreeMeta, settings: {} })
    const hash = () => createHash('sha256').update(readFileSync(file)).digest('hex')
    const before = hash()
    readOrcaProfile(file)
    expect(hash()).toBe(before)
  })

  it("ne crée aucun fichier à côté de la base d'Orca (base en WAL fermée)", () => {
    const file = makeProfile('p', { repos, worktreeMeta, settings: {} })
    const wal = new DatabaseSync(file)
    wal.exec('PRAGMA journal_mode = WAL')
    wal.close()
    const before = readdirSync(dirname(file)).sort()
    expect(readOrcaProfile(file).repos).toHaveLength(2)
    expect(readdirSync(dirname(file)).sort()).toEqual(before)
  })

  it("lit aussi ce qu'Orca n'a pas encore reporté du WAL dans la base", () => {
    const file = makeProfile('p', { repos: [], worktreeMeta: {}, settings: {} })
    const orca = new DatabaseSync(file)
    orca.exec('PRAGMA journal_mode = WAL')
    orca
      .prepare("UPDATE profile_state_documents SET payload = ? WHERE domain = 'repos'")
      .run(JSON.stringify(repos))
    try {
      expect(readOrcaProfile(file).repos).toHaveLength(2)
    } finally {
      orca.close()
    }
  })

  it('ignore les entrées invalides en le signalant', () => {
    const file = makeProfile('p', {
      repos: [...repos, { id: 'bad', path: 'relatif', kind: 'git' }, 'pas un objet'],
      worktreeMeta,
      settings: { workspaceDir: 42 },
    })
    const result = readOrcaProfile(file)
    expect(result.repos).toHaveLength(2)
    expect(result.workspaceDir).toBeNull()
    expect(result.warnings.join(' ')).toMatch(/2 dépôt\(s\) ignoré\(s\)/)
  })

  it('un JSON illisible donne une liste vide et un avertissement, pas une exception', () => {
    const file = makeProfile('p', {}, { repos: '{pas du json', worktreeMeta: '{}' })
    const result = readOrcaProfile(file)
    expect(result.repos).toEqual([])
    expect(result.warnings.join(' ')).toMatch(/repos/)
  })

  it('un schéma inconnu (table absente) donne un résultat vide et un avertissement', () => {
    const dir = join(configHome, 'orca/profiles/p')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'profile-state.db')
    new DatabaseSync(file).close()
    expect(readOrcaProfile(file)).toMatchObject({ repos: [], worktrees: [], workspaceDir: null })
    expect(readOrcaProfile(file).warnings).toHaveLength(1)
  })
})

describe('readOrcaConfig', () => {
  it("renvoie un résultat vide, sans avertissement, quand Orca n'est pas installé", () => {
    expect(readOrcaConfig(configHome)).toEqual({ repos: [], worktrees: [], workspaceDir: null, warnings: [] })
  })

  it('signale un dossier profiles illisible au lieu de planter', () => {
    mkdirSync(join(configHome, 'orca'), { recursive: true })
    writeFileSync(join(configHome, 'orca/profiles'), 'pas un dossier')
    const result = readOrcaConfig(configHome)
    expect(result.repos).toEqual([])
    expect(result.warnings).toHaveLength(1)
  })

  it('fusionne plusieurs profils sans doublon', () => {
    makeProfile('a', { repos, worktreeMeta, settings: { workspaceDir: '/home/u/ws' } })
    makeProfile('b', { repos: [repos[0]], worktreeMeta: {}, settings: {} })
    const result = readOrcaConfig(configHome)
    expect(result.repos.map((r) => r.path)).toEqual(['/home/u/projects/alpha', '/home/u/projects/beta'])
    expect(result.worktrees).toHaveLength(2)
    expect(result.workspaceDir).toBe('/home/u/ws')
  })
})

describe('readSnapshot', () => {
  // Simule Orca qui écrit pendant la copie : la source change entre la copie de la base et celle du WAL.
  const writerDuringCopy = (file: string, times: number) => {
    let left = times
    return (from: string, to: string) => {
      copyFileSync(from, to)
      if (left-- > 0) appendFileSync(`${file}-wal`, 'x')
    }
  }

  it('recommence la copie si la base change pendant la lecture', () => {
    const file = makeProfile('p', { repos, worktreeMeta: {}, settings: {} })
    writeFileSync(`${file}-wal`, '')
    expect(readSnapshot(file, writerDuringCopy(file, 1)).has('repos')).toBe(true)
  })

  it('abandonne après 3 essais si la base change sans arrêt', () => {
    const file = makeProfile('p', { repos, worktreeMeta: {}, settings: {} })
    writeFileSync(`${file}-wal`, '')
    expect(() => readSnapshot(file, writerDuringCopy(file, 99))).toThrow(/modifiée pendant la lecture/)
  })
})
