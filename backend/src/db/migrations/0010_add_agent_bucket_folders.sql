-- Add bucket_folder column for per-agent folder scoping
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "bucket_folder" TEXT;

-- Backfill existing agents: derive folder slug from agent name
-- Converts name to lowercase, replaces non-alphanumeric with hyphens, trims
UPDATE "agents"
SET "bucket_folder" = '/agent-' || regexp_replace(
    regexp_replace(lower(trim(name)), '[^a-z0-9]+', '-', 'g'),
    '(^-+|-+$)', '', 'g'
)
WHERE "bucket_folder" IS NULL;
