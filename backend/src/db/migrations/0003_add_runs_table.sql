-- Run status enum
DO $$ BEGIN
    CREATE TYPE run_status AS ENUM ('queued', 'in_progress', 'completed', 'failed', 'interrupted', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Runs table: tracks agent execution lifecycle
CREATE TABLE IF NOT EXISTS runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    status run_status NOT NULL DEFAULT 'queued',
    error TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index for finding active runs by session (the most common query)
CREATE INDEX IF NOT EXISTS idx_runs_session_status ON runs(session_id, status);

-- Index for workspace-level queries
CREATE INDEX IF NOT EXISTS idx_runs_workspace ON runs(workspace_id);

-- Prevent concurrent active runs on the same session (database-level guard)
CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_one_active_per_session
    ON runs(session_id)
    WHERE status IN ('queued', 'in_progress', 'interrupted');
