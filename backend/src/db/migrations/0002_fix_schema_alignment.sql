-- Migration: Fix schema alignment for production
-- Fixes issues where 0000 was marked applied but didn't fully execute.
-- This migration is fully idempotent — safe to re-run.

-- 1. Drop old tables that may still exist
DROP TABLE IF EXISTS "workflow_steps" CASCADE;
DROP TABLE IF EXISTS "workflows" CASCADE;
DROP TABLE IF EXISTS "tasks" CASCADE;

-- 2. Fix schedules: rename target_id → agent_id if still needed
DO $$
BEGIN
    -- If target_id exists but agent_id does not, add agent_id and migrate data
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='schedules' AND column_name='target_id')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='schedules' AND column_name='agent_id') THEN
        ALTER TABLE "schedules" ADD COLUMN "agent_id" uuid;
        UPDATE "schedules" SET "agent_id" = "target_id";
        ALTER TABLE "schedules" ALTER COLUMN "agent_id" SET NOT NULL;
        -- Add foreign key
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'schedules_agent_id_agents_id_fk') THEN
            ALTER TABLE "schedules" ADD CONSTRAINT "schedules_agent_id_agents_id_fk"
                FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
        END IF;
    END IF;

    -- If agent_id exists but is nullable, make it NOT NULL
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='schedules' AND column_name='agent_id' AND is_nullable='YES') THEN
        -- Fill any NULLs from target_id if available
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='schedules' AND column_name='target_id') THEN
            UPDATE "schedules" SET "agent_id" = "target_id" WHERE "agent_id" IS NULL;
        END IF;
        ALTER TABLE "schedules" ALTER COLUMN "agent_id" SET NOT NULL;
    END IF;
END $$;

-- 3. Add prompt column if missing
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "prompt" text;
UPDATE "schedules" SET "prompt" = "name" WHERE "prompt" IS NULL;
ALTER TABLE "schedules" ALTER COLUMN "prompt" SET NOT NULL;

-- 4. Add FK constraint if missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'schedules_agent_id_agents_id_fk') THEN
        ALTER TABLE "schedules" ADD CONSTRAINT "schedules_agent_id_agents_id_fk"
            FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;

-- 5. Drop old columns from schedules
ALTER TABLE "schedules" DROP COLUMN IF EXISTS "target_type";
ALTER TABLE "schedules" DROP COLUMN IF EXISTS "target_id";

-- 6. Drop old enums that confuse drizzle-kit push
DROP TYPE IF EXISTS "schedule_target_type";
DROP TYPE IF EXISTS "task_status";

-- 7. Remove can_manage_tasks from agents
ALTER TABLE "agents" DROP COLUMN IF EXISTS "can_manage_tasks";

-- 8. Create proxy enums if they don't exist (so drizzle-kit push doesn't prompt)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'proxy_protocol') THEN
        CREATE TYPE "proxy_protocol" AS ENUM ('http', 'https', 'socks5');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'proxy_test_status') THEN
        CREATE TYPE "proxy_test_status" AS ENUM ('success', 'failed', 'untested');
    END IF;
END $$;

-- 9. Add metadata column to messages if missing
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}' NOT NULL;
