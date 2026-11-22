CREATE TABLE projects (
  id       TEXT PRIMARY KEY,
  path     TEXT NOT NULL UNIQUE, -- racine du dépôt principal, chemin absolu réel
  name     TEXT NOT NULL,
  added_at INTEGER NOT NULL      -- ms depuis l'epoch
);
