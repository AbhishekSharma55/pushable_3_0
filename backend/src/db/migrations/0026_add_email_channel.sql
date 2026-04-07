-- Email Channel Integration: workspace email addresses, approved senders, inbound emails

CREATE TYPE "email_status" AS ENUM(
    'received',
    'routing',
    'processing',
    'awaiting_approval',
    'approved',
    'rejected',
    'completed',
    'failed',
    'spam'
);

CREATE TABLE IF NOT EXISTS "email_workspace_addresses" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "address" text NOT NULL,
    "display_name" text,
    "custom_instructions" text,
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "email_workspace_addresses_workspace_id_unique" UNIQUE("workspace_id"),
    CONSTRAINT "email_workspace_addresses_address_unique" UNIQUE("address")
);

CREATE TABLE IF NOT EXISTS "email_approved_senders" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "sender_pattern" text NOT NULL,
    "note" text,
    "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "inbound_emails" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "email_address_id" uuid REFERENCES "email_workspace_addresses"("id") ON DELETE SET NULL,
    "session_id" uuid REFERENCES "sessions"("id") ON DELETE SET NULL,
    "from_address" text NOT NULL,
    "from_name" text,
    "to_address" text NOT NULL,
    "subject" text,
    "body_text" text,
    "body_html" text,
    "cc" text,
    "message_id" text,
    "in_reply_to" text,
    "references" text,
    "status" "email_status" DEFAULT 'received' NOT NULL,
    "routed_to_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
    "status_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "reply_sent" boolean DEFAULT false NOT NULL,
    "reply_content" text,
    "error_message" text,
    "raw_payload" jsonb,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_email_workspace_addresses_workspace" ON "email_workspace_addresses"("workspace_id");
CREATE INDEX IF NOT EXISTS "idx_email_approved_senders_workspace" ON "email_approved_senders"("workspace_id");
CREATE INDEX IF NOT EXISTS "idx_inbound_emails_workspace" ON "inbound_emails"("workspace_id");
CREATE INDEX IF NOT EXISTS "idx_inbound_emails_status" ON "inbound_emails"("status");
CREATE INDEX IF NOT EXISTS "idx_inbound_emails_from" ON "inbound_emails"("from_address");
CREATE INDEX IF NOT EXISTS "idx_inbound_emails_message_id" ON "inbound_emails"("message_id");
