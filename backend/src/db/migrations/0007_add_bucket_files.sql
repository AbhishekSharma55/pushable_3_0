-- Bucket files table for persistent file storage
DO $$ BEGIN
    CREATE TYPE "file_source" AS ENUM ('chat_upload', 'agent_generated', 'api_upload');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "bucket_files" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "filename" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL UNIQUE,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "folder" TEXT NOT NULL DEFAULT '/',
    "source" file_source NOT NULL,
    "session_id" UUID REFERENCES "sessions"("id") ON DELETE SET NULL,
    "agent_id" UUID REFERENCES "agents"("id") ON DELETE SET NULL,
    "uploaded_by" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_bucket_files_workspace" ON "bucket_files"("workspace_id");
CREATE INDEX IF NOT EXISTS "idx_bucket_files_folder" ON "bucket_files"("workspace_id", "folder");
CREATE INDEX IF NOT EXISTS "idx_bucket_files_session" ON "bucket_files"("session_id");

-- Add can_manage_bucket permission to agents
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "can_manage_bucket" BOOLEAN NOT NULL DEFAULT false;
