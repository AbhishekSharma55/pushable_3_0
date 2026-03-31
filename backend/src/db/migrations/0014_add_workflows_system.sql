-- Workflow Recipes system: workflows + workflow_runs tables

CREATE TYPE "workflow_run_status" AS ENUM('running', 'completed', 'failed');

CREATE TABLE "workflows" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "description" text,
    "input_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "recipe" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "source_session_id" uuid,
    "enabled" boolean DEFAULT true NOT NULL,
    "last_run_at" timestamp,
    "run_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "workflow_runs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "workflow_id" uuid NOT NULL REFERENCES "workflows"("id") ON DELETE CASCADE,
    "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "status" "workflow_run_status" DEFAULT 'running' NOT NULL,
    "input_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "result_text" text,
    "error" text,
    "credits_used" integer DEFAULT 0 NOT NULL,
    "duration_ms" integer,
    "step_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "started_at" timestamp DEFAULT now() NOT NULL,
    "completed_at" timestamp
);

-- Add workflow_id FK to schedules (allows schedule → workflow routing)
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "workflow_id" uuid REFERENCES "workflows"("id") ON DELETE SET NULL;

-- Add workflow_run to the ledger type enum
ALTER TYPE "ledger_type" ADD VALUE IF NOT EXISTS 'workflow_run';
