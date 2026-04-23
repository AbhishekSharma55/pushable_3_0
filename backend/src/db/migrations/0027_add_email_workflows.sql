-- Add prefix column to email_workspace_addresses for Manus-style prefix editing
ALTER TABLE "email_workspace_addresses" ADD COLUMN IF NOT EXISTS "prefix" text;

-- Backfill prefix from existing address (extract part before @)
UPDATE "email_workspace_addresses" SET "prefix" = split_part("address", '@', 1) WHERE "prefix" IS NULL;

-- Workflow email sub-addresses with custom instructions
CREATE TABLE IF NOT EXISTS "email_workflow_addresses" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "email_address_id" uuid NOT NULL REFERENCES "email_workspace_addresses"("id") ON DELETE CASCADE,
    "suffix" text NOT NULL,
    "full_address" text NOT NULL UNIQUE,
    "instructions" text NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_email_workflow_addresses_workspace" ON "email_workflow_addresses"("workspace_id");
CREATE INDEX IF NOT EXISTS "idx_email_workflow_addresses_full_address" ON "email_workflow_addresses"("full_address");
