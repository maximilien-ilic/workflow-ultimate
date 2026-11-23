CREATE TABLE projects (
  id       TEXT PRIMARY KEY,
  path     TEXT NOT NULL UNIQUE, -- dossier de travail principal, chemin absolu réel
  git_dir  TEXT NOT NULL UNIQUE, -- dossier git commun : identité fiable du dépôt, même vu depuis un worktree lié
  name     TEXT NOT NULL,
  added_at INTEGER NOT NULL      -- ms depuis l'epoch
);
