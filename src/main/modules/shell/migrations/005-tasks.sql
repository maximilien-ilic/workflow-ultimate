CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('todo', 'doing', 'review', 'done'))
);

CREATE INDEX tasks_project ON tasks (project_id, id);
