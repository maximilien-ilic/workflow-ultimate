import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dataDir, migrate, openDatabase, parseMigrations, type Migration } from './db'

let dir: string
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'wu-db-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const version = (db: DatabaseSync) => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
const tables = (db: DatabaseSync) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map(
    (t) => t.name,
  )

const m1: Migration = { version: 1, name: 'a', sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY);' }
const m2: Migration = { version: 2, name: 'b', sql: 'CREATE TABLE b (id INTEGER PRIMARY KEY);' }

describe('dataDir', () => {
  it('respecte XDG_DATA_HOME', () => {
    expect(dataDir({ XDG_DATA_HOME: '/x/data' }, '/home/u')).toBe('/x/data/workflow-ultimate')
  })
  it('retombe sur ~/.local/share', () => {
    expect(dataDir({}, '/home/u')).toBe('/home/u/.local/share/workflow-ultimate')
  })
})

describe('parseMigrations', () => {
  it('trie par numéro et extrait le nom', () => {
    const parsed = parseMigrations({ './migrations/002-b.sql': 'B', './migrations/001-a.sql': 'A' })
    expect(parsed).toEqual([
      { version: 1, name: 'a', sql: 'A' },
      { version: 2, name: 'b', sql: 'B' },
    ])
  })
  it.each([
    ['nom invalide', { './migrations/init.sql': '' }],
    ['trou dans la numérotation', { './migrations/001-a.sql': '', './migrations/003-c.sql': '' }],
    ['numéro en double', { './migrations/001-a.sql': '', './x/001-b.sql': '' }],
  ])('refuse : %s', (_label, files) => {
    expect(() => parseMigrations(files)).toThrow()
  })
})

describe('migrate', () => {
  it("applique les migrations dans l'ordre et note la version", () => {
    const db = new DatabaseSync(join(dir, 'app.db'))
    migrate(db, [m1, m2])
    expect(version(db)).toBe(2)
    expect(tables(db)).toEqual(['a', 'b'])
  })

  it("n'applique que les migrations manquantes", () => {
    const db = new DatabaseSync(join(dir, 'app.db'))
    migrate(db, [m1])
    db.exec('INSERT INTO a DEFAULT VALUES')
    migrate(db, [m1, m2])
    expect(version(db)).toBe(2)
    expect(db.prepare('SELECT count(*) n FROM a').get()).toEqual({ n: 1 })
  })

  it('annule une migration qui échoue sans toucher aux précédentes', () => {
    const db = new DatabaseSync(join(dir, 'app.db'))
    const broken: Migration = { version: 2, name: 'broken', sql: 'CREATE TABLE b (id INTEGER); SELECT * FROM nope;' }
    expect(() => migrate(db, [m1, broken])).toThrow(/002-broken/)
    expect(version(db)).toBe(1)
    expect(tables(db)).toEqual(['a'])
  })

  it("refuse une base plus récente que l'appli (pas de retour arrière silencieux)", () => {
    const db = new DatabaseSync(join(dir, 'app.db'))
    migrate(db, [m1, m2])
    expect(() => migrate(db, [m1])).toThrow(/plus récente/)
  })
})

describe('openDatabase', () => {
  it("ne modifie pas une base plus récente que l'appli avant de la refuser", () => {
    const file = join(dir, 'app.db')
    const db = new DatabaseSync(file)
    db.exec('PRAGMA user_version = 9')
    db.close()
    expect(() => openDatabase(file, [m1])).toThrow(/plus récente/)
    const check = new DatabaseSync(file)
    expect(check.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'delete' })
    check.close()
  })

  it('refuse une version négative (jamais écrite par l’appli)', () => {
    const file = join(dir, 'app.db')
    const db = new DatabaseSync(file)
    db.exec('PRAGMA user_version = -1')
    db.close()
    expect(() => openDatabase(file, [m1])).toThrow(/version -1/)
  })

  it('refuse une base corrompue dès l’ouverture', () => {
    const file = join(dir, 'app.db')
    const db = new DatabaseSync(file)
    db.exec("CREATE TABLE t (x TEXT); INSERT INTO t VALUES (randomblob(3000)), (randomblob(3000));")
    db.close()
    const bytes = readFileSync(file)
    bytes.fill(0xff, 4096, 4096 + 16) // abîme l'en-tête de la page 2 (structure), pas celui du fichier
    writeFileSync(file, bytes)
    expect(() => openDatabase(file, [m1])).toThrow(/corrompue/)
  })

  it('crée le dossier, active WAL et migre', () => {
    const file = join(dir, 'sous/dossier/app.db')
    const db = openDatabase(file, [m1])
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    expect(version(db)).toBe(1)
    db.close()
  })
})
