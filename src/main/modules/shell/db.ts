import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { appDirectory } from './paths'

export type Migration = { version: number; name: string; sql: string }

// Même calcul que le diagnostic (paths.ts) : une seule destination possible pour app.db.
export const dataDir = (env: NodeJS.ProcessEnv = process.env, home = homedir()) =>
  appDirectory('data', env, home)

// Fichiers `NNN-nom.sql`, numérotés de 1 à n sans trou ni doublon.
export function parseMigrations(files: Record<string, string>): Migration[] {
  const migrations = Object.entries(files).map(([path, sql]) => {
    const match = /^(\d{3})-([\w-]+)\.sql$/.exec(basename(path))
    if (!match) throw new Error(`Nom de migration invalide : ${path} (attendu : NNN-nom.sql)`)
    return { version: Number(match[1]), name: match[2] ?? '', sql }
  })
  migrations.sort((a, b) => a.version - b.version)
  migrations.forEach((m, i) => {
    if (m.version !== i + 1)
      throw new Error(`Migrations : ${i + 1} attendue, ${m.version} trouvée (${m.name})`)
  })
  return migrations
}

const pad = (n: number) => String(n).padStart(3, '0')

const userVersion = (db: DatabaseSync) =>
  (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version

// Une base migrée par une version plus récente de l'appli ne doit pas être réutilisée à l'aveugle.
function assertNotNewer(current: number, migrations: Migration[]): void {
  if (current < 0)
    throw new Error(`Base en version ${current} : valeur impossible, base non créée par l'appli`)
  if (current > migrations.length)
    throw new Error(`Base en version ${current}, plus récente que l'appli (${migrations.length})`)
}

export function migrate(db: DatabaseSync, migrations: Migration[]): void {
  for (;;) {
    // La version est relue sous le verrou : deux connexions ne peuvent pas rejouer la même migration.
    db.exec('BEGIN IMMEDIATE')
    let m: Migration | undefined
    try {
      const current = userVersion(db)
      assertNotNewer(current, migrations)
      m = migrations[current]
      if (m) {
        db.exec(m.sql)
        db.exec(`PRAGMA user_version = ${m.version}`)
      }
      db.exec('COMMIT')
    } catch (error) {
      // SQLite a pu annuler la transaction lui-même (INSERT OR ROLLBACK…) : un second ROLLBACK
      // échouerait et masquerait la vraie cause.
      if (db.isTransaction) db.exec('ROLLBACK')
      if (!m) throw error
      throw new Error(`Migration ${pad(m.version)}-${m.name} échouée : ${(error as Error).message}`, {
        cause: error,
      })
    }
    if (!m) return
  }
}

// Réessaie une opération tant que la base est verrouillée ailleurs, dans la limite de `ms`
// (attente synchrone : seulement au démarrage, avant toute fenêtre).
function whileBusy(operation: () => void, ms: number): void {
  const deadline = Date.now() + ms
  for (;;) {
    try {
      return operation()
    } catch (error) {
      if (!/database is locked|SQLITE_BUSY/i.test((error as Error).message) || Date.now() > deadline)
        throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
    }
  }
}

export function openDatabase(file: string, migrations: Migration[]): DatabaseSync {
  mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  try {
    // Politique d'attente dès l'ouverture : un verrou brièvement tenu ailleurs ne fait pas échouer le démarrage.
    db.exec('PRAGMA busy_timeout = 5000')
    // Vérifications avant toute écriture : on ne touche pas une base corrompue ou trop récente.
    const { quick_check } = db.prepare('PRAGMA quick_check').get() as { quick_check: string }
    if (quick_check !== 'ok') throw new Error(`Base corrompue (${file}) : ${quick_check}`)
    assertNotNewer(userVersion(db), migrations)
    // Le passage en WAL renvoie SQLITE_BUSY sans passer par busy_timeout : on réessaie nous-mêmes.
    whileBusy(() => db.exec('PRAGMA journal_mode = WAL'), 5000)
    db.exec('PRAGMA foreign_keys = ON')
    migrate(db, migrations)
    return db
  } catch (error) {
    db.close()
    if (/not a database|malformed/i.test((error as Error).message))
      throw new Error(`Base corrompue (${file}) : ${(error as Error).message}`, { cause: error })
    throw error
  }
}
