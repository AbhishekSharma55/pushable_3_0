-- Schedule run status enum
DO $$ BEGIN
    CREATE TYPE schedule_run_status AS ENUM ('running', 'completed', 'failed', 'skipped');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Schedule runs table: tracks every schedule execution
CREATE TABLE IF NOT EXISTS schedule_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    status schedule_run_status NOT NULL DEFAULT 'running',
    result_text TEXT,
    error TEXT,
    credits_used INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- Index for fetching runs by schedule (most common query)
CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule_started
    ON schedule_runs(schedule_id, started_at DESC);

-- Index for workspace-level queries
CREATE INDEX IF NOT EXISTS idx_schedule_runs_workspace
    ON schedule_runs(workspace_id);
