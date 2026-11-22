import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type Migration = { version: number; name: string; sql: string }

export function dataDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return join(env['XDG_DATA_HOME'] || join(home, '.local/share'), 'workflow-ultimate')
}

// Fichiers `NNN-nom.sql`, numérotés de 1 à n sans trou ni doublon.
export function parseMigrations(files: Record<string, string>): Migration[] {
  const migrations = Object.entries(files).map(([path, sql]) => {
    const match = /^(\d{3})-([\w-]+)\.sql$/.exec(basename(path))
    if (!match) throw new Error(`Nom de migration invalide : ${path} (attendu : NNN-nom.sql)`)
    return { version: Number(match[1]), name: match[2] ?? '', sql }
  })
  migrations.sort((a, b) => a.version - b.version)
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`Migrations : ${i + 1} attendue, ${m.version} trouvée (${m.name})`)
  })
  return migrations
}

const pad = (n: number) => String(n).padStart(3, '0')

export function migrate(db: DatabaseSync, migrations: Migration[]): void {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  // Une base migrée par une version plus récente de l'appli ne doit pas être réutilisée à l'aveugle.
  if (current > migrations.length)
    throw new Error(`Base en version ${current}, plus récente que l'appli (${migrations.length})`)

  for (const m of migrations.slice(current)) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(m.sql)
      db.exec(`PRAGMA user_version = ${m.version}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw new Error(`Migration ${pad(m.version)}-${m.name} échouée : ${(error as Error).message}`, { cause: error })
    }
  }
}

export function openDatabase(file: string, migrations: Migration[]): DatabaseSync {
  mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  migrate(db, migrations)
  return db
}
