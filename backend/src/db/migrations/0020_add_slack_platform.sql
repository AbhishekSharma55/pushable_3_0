-- Slack installations: stores OAuth tokens per Slack workspace that installed the platform app
CREATE TABLE IF NOT EXISTS "slack_installations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "slack_team_id" text NOT NULL UNIQUE,
    "slack_team_name" text,
    "bot_token" text NOT NULL,
    "bot_user_id" text,
    "bot_id" text,
    "installed_by_slack_user_id" text,
    "scope" text,
    "is_enterprise_install" boolean DEFAULT false,
    "enterprise_id" text,
    "enterprise_name" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "idx_slack_installations_team_id" ON "slack_installations"("slack_team_id");

-- Slack user links: maps Slack users to Pushable users for the platform bot
CREATE TABLE IF NOT EXISTS "slack_user_links" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "slack_user_id" text NOT NULL,
    "slack_team_id" text NOT NULL,
    "slack_username" text,
    "slack_display_name" text,
    "slack_dm_channel_id" text,
    "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
    "verified_at" timestamp,
    "last_message_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    UNIQUE("slack_team_id", "slack_user_id")
);

CREATE INDEX "idx_slack_links_workspace" ON "slack_user_links"("workspace_id");
CREATE INDEX "idx_slack_links_team_user" ON "slack_user_links"("slack_team_id", "slack_user_id");
