-- Migration: Remove tasks/workflows, simplify schedules to prompt-based
-- This migration is fully idempotent — safe to re-run.

-- 1. Drop dependent tables first
DROP TABLE IF EXISTS "workflow_steps" CASCADE;
DROP TABLE IF EXISTS "workflows" CASCADE;
DROP TABLE IF EXISTS "tasks" CASCADE;

-- 2. Drop unused enums
DROP TYPE IF EXISTS "task_status";

-- 3. Add new columns to schedules (IF NOT EXISTS handles re-runs)
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "agent_id" uuid;
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "prompt" text;

-- 4. Migrate existing schedule data (only if old columns still exist)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='schedules' AND column_name='target_id') THEN
        UPDATE "schedules" SET "agent_id" = "target_id" WHERE "agent_id" IS NULL;
    END IF;
END $$;

UPDATE "schedules" SET "prompt" = "name" WHERE "prompt" IS NULL;

-- 5. Make new columns NOT NULL (safe even if already NOT NULL)
ALTER TABLE "schedules" ALTER COLUMN "agent_id" SET NOT NULL;
ALTER TABLE "schedules" ALTER COLUMN "prompt" SET NOT NULL;

-- 6. Add foreign key for agent_id (skip if already exists)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'schedules_agent_id_agents_id_fk') THEN
        ALTER TABLE "schedules" ADD CONSTRAINT "schedules_agent_id_agents_id_fk"
            FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;

-- 7. Drop old columns from schedules
ALTER TABLE "schedules" DROP COLUMN IF EXISTS "target_type";
ALTER TABLE "schedules" DROP COLUMN IF EXISTS "target_id";

-- 8. Drop the schedule_target_type enum
DROP TYPE IF EXISTS "schedule_target_type";

-- 9. Remove can_manage_tasks from agents
ALTER TABLE "agents" DROP COLUMN IF EXISTS "can_manage_tasks";
