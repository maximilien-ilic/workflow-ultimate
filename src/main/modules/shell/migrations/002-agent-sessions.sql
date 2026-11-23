CREATE TABLE agent_sessions (
  id         TEXT PRIMARY KEY,  -- notre id de session, aussi utilisé comme --session-id de Claude
  agent      TEXT NOT NULL,     -- 'claude-code' (codex : #24)
  cwd        TEXT NOT NULL,
  state      TEXT NOT NULL,     -- starting | working | waiting | done | error
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
