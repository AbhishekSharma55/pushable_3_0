ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "can_execute_python" boolean NOT NULL DEFAULT true;

-- Enable Python for all existing agents
UPDATE "agents" SET "can_execute_python" = true WHERE "can_execute_python" = false;
