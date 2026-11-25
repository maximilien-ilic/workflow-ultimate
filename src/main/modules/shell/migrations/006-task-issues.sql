ALTER TABLE tasks ADD COLUMN issue_number INTEGER CHECK (issue_number > 0);
ALTER TABLE tasks ADD COLUMN issue_url TEXT;

-- Une issue n'a qu'une tâche par projet : la réimportation met à jour au lieu de dupliquer.
CREATE UNIQUE INDEX tasks_issue ON tasks (project_id, issue_number);
