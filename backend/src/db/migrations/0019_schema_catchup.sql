-- ============================================================================
-- SCHEMA CATCH-UP MIGRATION
-- Safe to run on both fresh and existing databases (uses IF NOT EXISTS / IF NOT EXISTS)
-- Ensures DB matches all Drizzle schema definitions
-- ============================================================================

-- ─── ENUMS (create if missing) ─────────────────────────────────────────────

DO $$ BEGIN CREATE TYPE ledger_type AS ENUM ('subscription_grant','topup','chat_message','task_run','workflow_step','workflow_run','kb_upload','kb_query','browser_action','scheduled_run_fee','agent_delegation','overage','refund','manual_adjustment'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE connection_channel_type AS ENUM ('telegram','slack'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE connection_status AS ENUM ('active','inactive','error'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE proxy_protocol AS ENUM ('http','https','socks5'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE proxy_test_status AS ENUM ('success','failed','untested'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE llm_provider AS ENUM ('openai','anthropic','google','deepseek','meta'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE plan_tier AS ENUM ('free','starter','pro','scale'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE schedule_type AS ENUM ('natural','preset','custom'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE integration_status AS ENUM ('active','inactive','pending','failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE tool_type AS ENUM ('mcp','function'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE vault_provider AS ENUM ('bitwarden'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE vault_connection_status AS ENUM ('active','inactive','failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE vault_audit_action AS ENUM ('connect','disconnect','credential_fetch','token_refresh','test','error'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE channel_type AS ENUM ('telegram','slack'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── MISSING TABLES ────────────────────────────────────────────────────────

-- credit_ledger
CREATE TABLE IF NOT EXISTS "credit_ledger" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "amount" integer NOT NULL,
    "type" ledger_type NOT NULL,
    "credits_after" integer NOT NULL,
    "metadata" jsonb NOT NULL DEFAULT '{}',
    "created_at" timestamp DEFAULT now() NOT NULL
);

-- channel_connections
CREATE TABLE IF NOT EXISTS "channel_connections" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
    "channel_type" connection_channel_type NOT NULL,
    "name" text NOT NULL,
    "status" connection_status NOT NULL DEFAULT 'inactive',
    "credentials" jsonb NOT NULL DEFAULT '{}',
    "config" jsonb NOT NULL DEFAULT '{}',
    "error_message" text,
    "last_message_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

-- browser_proxies
CREATE TABLE IF NOT EXISTS "browser_proxies" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "label" text NOT NULL,
    "host" text NOT NULL,
    "port" integer NOT NULL,
    "username" text NOT NULL,
    "password" text NOT NULL,
    "protocol" proxy_protocol NOT NULL DEFAULT 'http',
    "country" text,
    "city" text,
    "is_active" boolean NOT NULL DEFAULT true,
    "last_tested_at" timestamp,
    "last_test_status" proxy_test_status NOT NULL DEFAULT 'untested',
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

-- agent_memories
CREATE TABLE IF NOT EXISTS "agent_memories" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
    "user_id" text NOT NULL,
    "content" text NOT NULL,
    "category" text NOT NULL DEFAULT 'general',
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

-- llm_models
CREATE TABLE IF NOT EXISTS "llm_models" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "provider" llm_provider NOT NULL,
    "model_id" text NOT NULL UNIQUE,
    "display_name" text NOT NULL,
    "description" text,
    "multiplier" numeric(4, 2) NOT NULL DEFAULT '1.00',
    "context_window" integer,
    "is_active" boolean NOT NULL DEFAULT true,
    "minimum_plan" plan_tier NOT NULL DEFAULT 'pro',
    "is_featured" boolean NOT NULL DEFAULT false,
    "sort_order" integer NOT NULL DEFAULT 0,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

-- vault_connections
CREATE TABLE IF NOT EXISTS "vault_connections" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "provider" vault_provider NOT NULL,
    "encrypted_access_token" text NOT NULL,
    "encrypted_refresh_token" text NOT NULL,
    "encrypted_vault_key" text NOT NULL,
    "email" text NOT NULL,
    "kdf_iterations" integer NOT NULL,
    "token_expires_at" timestamp NOT NULL,
    "device_identifier" text NOT NULL,
    "status" vault_connection_status NOT NULL DEFAULT 'active',
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

-- vault_audit_logs
CREATE TABLE IF NOT EXISTS "vault_audit_logs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "connection_id" uuid,
    "action" vault_audit_action NOT NULL,
    "item_name" text,
    "success" boolean NOT NULL,
    "error_message" text,
    "metadata" jsonb,
    "created_at" timestamp DEFAULT now() NOT NULL
);

-- input_channels
CREATE TABLE IF NOT EXISTS "input_channels" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
    "type" channel_type NOT NULL,
    "config" jsonb NOT NULL DEFAULT '{}',
    "enabled" boolean NOT NULL DEFAULT true,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

-- user_credit_limits
CREATE TABLE IF NOT EXISTS "user_credit_limits" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "credit_limit" integer NOT NULL,
    "credits_used" integer NOT NULL DEFAULT 0,
    "period_start" timestamp DEFAULT now() NOT NULL,
    "period_end" timestamp,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    UNIQUE("workspace_id", "user_id")
);

-- user_agent_access
CREATE TABLE IF NOT EXISTS "user_agent_access" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
    "allowed" boolean NOT NULL DEFAULT true,
    "created_at" timestamp DEFAULT now() NOT NULL,
    UNIQUE("workspace_id", "user_id", "agent_id")
);

-- ─── MISSING COLUMNS ON EXISTING TABLES ────────────────────────────────────

-- agents: permission & config columns
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "emoji" text;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "system_level_access" boolean NOT NULL DEFAULT false;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "can_manage_kb" boolean NOT NULL DEFAULT false;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "can_manage_skills" boolean NOT NULL DEFAULT false;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "can_manage_tools" boolean NOT NULL DEFAULT false;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "can_manage_schedules" boolean NOT NULL DEFAULT false;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "can_manage_channels" boolean NOT NULL DEFAULT false;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "can_manage_agents" boolean NOT NULL DEFAULT false;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "can_manage_bucket" boolean NOT NULL DEFAULT true;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "can_execute_python" boolean NOT NULL DEFAULT true;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "bucket_folder" text;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "require_approval_for_all" boolean NOT NULL DEFAULT false;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "browser_type" text NOT NULL DEFAULT 'cloud';
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "browser_enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "browser_proxy_id" uuid REFERENCES "browser_proxies"("id") ON DELETE SET NULL;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "is_ceo" boolean NOT NULL DEFAULT false;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "is_tester" boolean NOT NULL DEFAULT false;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "agent_type" text NOT NULL DEFAULT 'worker';

-- workspaces: extension_api_key
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "extension_api_key" text;

-- users: google_id
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "google_id" text UNIQUE;
-- Make password_hash nullable (for Google OAuth users)
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- messages: metadata
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}';

-- credits: plan & overage columns
ALTER TABLE "credits" ADD COLUMN IF NOT EXISTS "plan_credits" integer NOT NULL DEFAULT 1000;
ALTER TABLE "credits" ADD COLUMN IF NOT EXISTS "topup_credits" integer NOT NULL DEFAULT 0;
ALTER TABLE "credits" ADD COLUMN IF NOT EXISTS "overage_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "credits" ADD COLUMN IF NOT EXISTS "overage_limit" integer NOT NULL DEFAULT 500;
ALTER TABLE "credits" ADD COLUMN IF NOT EXISTS "total_credits_consumed" integer NOT NULL DEFAULT 0;

-- tools: requires_approval
ALTER TABLE "tools" ADD COLUMN IF NOT EXISTS "requires_approval" boolean NOT NULL DEFAULT false;

-- integrations: connection display fields
ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "connection_label" text NOT NULL DEFAULT '';
ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "connection_description" text;
ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "connection_icon" text;

-- schedules: humanization & type fields
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "natural_language" text;
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "humanize_delay" integer NOT NULL DEFAULT 0;
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "timezone" text NOT NULL DEFAULT 'UTC';
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "business_hours_only" boolean NOT NULL DEFAULT false;
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "work_start_hour" integer NOT NULL DEFAULT 9;
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "work_end_hour" integer NOT NULL DEFAULT 18;
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "work_days" integer[] NOT NULL DEFAULT '{1,2,3,4,5}';
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "schedule_type" schedule_type NOT NULL DEFAULT 'natural';
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "preset_key" text;
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "next_run_description" text;
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "project_id" uuid;
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "workflow_id" uuid;
