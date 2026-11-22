import { parseMigrations } from '../db'

// Chaque fichier `NNN-nom.sql` de ce dossier est embarqué dans le build par Vite.
export const migrations = parseMigrations(
  import.meta.glob<string>('./*.sql', { query: '?raw', import: 'default', eager: true }),
)
