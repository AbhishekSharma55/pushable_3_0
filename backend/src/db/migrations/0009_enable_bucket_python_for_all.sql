-- Enable bucket and python for all agents by default
-- These capabilities are now always-on and no longer gated by permission toggles

UPDATE "agents" SET "can_manage_bucket" = true WHERE "can_manage_bucket" = false;
UPDATE "agents" SET "can_execute_python" = true WHERE "can_execute_python" = false;

-- Update defaults for new agents
ALTER TABLE "agents" ALTER COLUMN "can_manage_bucket" SET DEFAULT true;
