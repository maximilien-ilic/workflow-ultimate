-- Dépôt GitHub (owner/name) d'où viennent les issues du projet, fixé au premier import.
ALTER TABLE projects ADD COLUMN github_repo TEXT;
