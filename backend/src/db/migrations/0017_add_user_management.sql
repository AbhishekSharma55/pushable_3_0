-- User Management System: invitations, per-user credit limits, per-user agent access

-- Invitation status enum
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'expired', 'revoked');

-- Workspace invitations table
CREATE TABLE "workspace_invitations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "email" text NOT NULL,
    "role" "member_role" NOT NULL DEFAULT 'member',
    "invited_by" uuid NOT NULL REFERENCES "users"("id"),
    "token" text UNIQUE NOT NULL,
    "status" "invitation_status" NOT NULL DEFAULT 'pending',
    "expires_at" timestamp NOT NULL,
    "accepted_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL
);

-- User credit limits table (spending cap within workspace pool)
CREATE TABLE "user_credit_limits" (
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

-- User agent access table (per-user agent restrictions)
CREATE TABLE "user_agent_access" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
    "allowed" boolean NOT NULL DEFAULT true,
    "created_at" timestamp DEFAULT now() NOT NULL,
    UNIQUE("workspace_id", "user_id", "agent_id")
);

-- Indexes for query performance
CREATE INDEX "idx_invitations_workspace" ON "workspace_invitations"("workspace_id");
CREATE INDEX "idx_invitations_email" ON "workspace_invitations"("email");
CREATE INDEX "idx_invitations_token" ON "workspace_invitations"("token");
CREATE INDEX "idx_user_credit_limits_lookup" ON "user_credit_limits"("workspace_id", "user_id");
CREATE INDEX "idx_user_agent_access_lookup" ON "user_agent_access"("workspace_id", "user_id");
