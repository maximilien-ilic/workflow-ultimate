CREATE TABLE review_comments (
  id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  worktree_path TEXT NOT NULL,
  path TEXT NOT NULL,
  line INTEGER NOT NULL CHECK (line > 0),
  body TEXT NOT NULL,
  sent_at INTEGER
);

CREATE INDEX review_comments_worktree ON review_comments (project_id, worktree_path, id);
