ALTER TABLE tasks ADD COLUMN agent_session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN agent_branch TEXT;
