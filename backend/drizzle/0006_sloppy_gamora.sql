CREATE TYPE "public"."email_status" AS ENUM('received', 'routing', 'processing', 'awaiting_approval', 'approved', 'rejected', 'completed', 'failed', 'spam');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'expired', 'revoked');--> statement-breakpoint
CREATE TABLE "credit_cost_multipliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"above_dollar" numeric(10, 6) NOT NULL,
	"multiplier" numeric(10, 4) NOT NULL,
	"label" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_cost_ranges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"min_dollar" numeric(10, 6) NOT NULL,
	"max_dollar" numeric(10, 6) NOT NULL,
	"credit_amount" numeric(8, 4) NOT NULL,
	"label" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_approved_senders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sender_pattern" text NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_workspace_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"address" text NOT NULL,
	"display_name" text,
	"custom_instructions" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_workspace_addresses_workspace_id_unique" UNIQUE("workspace_id"),
	CONSTRAINT "email_workspace_addresses_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "inbound_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email_address_id" uuid,
	"session_id" uuid,
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
	"routed_to_agent_id" uuid,
	"status_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reply_sent" boolean DEFAULT false NOT NULL,
	"reply_content" text,
	"error_message" text,
	"raw_payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_bot_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'inactive' NOT NULL,
	"bot_name" text,
	"bot_username" text,
	"error_message" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "platform_bot_configs_platform_unique" UNIQUE("platform")
);
--> statement-breakpoint
CREATE TABLE "slack_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slack_team_id" text NOT NULL,
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
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "slack_installations_slack_team_id_unique" UNIQUE("slack_team_id")
);
--> statement-breakpoint
CREATE TABLE "slack_user_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slack_user_id" text NOT NULL,
	"slack_team_id" text NOT NULL,
	"slack_username" text,
	"slack_display_name" text,
	"slack_dm_channel_id" text,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"verified_at" timestamp,
	"last_message_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "slack_user_links_team_user_unique" UNIQUE("slack_team_id","slack_user_id")
);
--> statement-breakpoint
CREATE TABLE "telegram_user_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" text NOT NULL,
	"telegram_username" text,
	"telegram_first_name" text,
	"telegram_chat_id" text,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"verified_at" timestamp,
	"last_message_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_user_links_telegram_user_id_unique" UNIQUE("telegram_user_id")
);
--> statement-breakpoint
CREATE TABLE "user_agent_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"allowed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_agent_access_workspace_id_user_id_agent_id_unique" UNIQUE("workspace_id","user_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "user_credit_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"credit_limit" numeric(12, 4) NOT NULL,
	"credits_used" numeric(12, 4) DEFAULT '0' NOT NULL,
	"period_start" timestamp DEFAULT now() NOT NULL,
	"period_end" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_credit_limits_workspace_id_user_id_unique" UNIQUE("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_user_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"whatsapp_phone" text NOT NULL,
	"whatsapp_name" text,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"verified_at" timestamp,
	"last_message_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_user_links_whatsapp_phone_unique" UNIQUE("whatsapp_phone")
);
--> statement-breakpoint
CREATE TABLE "workspace_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"invited_by" uuid NOT NULL,
	"token" text NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "credit_ledger" ALTER COLUMN "amount" SET DATA TYPE numeric(12, 4);--> statement-breakpoint
ALTER TABLE "credit_ledger" ALTER COLUMN "credits_after" SET DATA TYPE numeric(12, 4);--> statement-breakpoint
ALTER TABLE "credit_logs" ALTER COLUMN "credits_deducted" SET DATA TYPE numeric(12, 4);--> statement-breakpoint
ALTER TABLE "credits" ALTER COLUMN "balance" SET DATA TYPE numeric(12, 4);--> statement-breakpoint
ALTER TABLE "credits" ALTER COLUMN "balance" SET DEFAULT '1000';--> statement-breakpoint
ALTER TABLE "credits" ALTER COLUMN "plan_credits" SET DATA TYPE numeric(12, 4);--> statement-breakpoint
ALTER TABLE "credits" ALTER COLUMN "plan_credits" SET DEFAULT '1000';--> statement-breakpoint
ALTER TABLE "credits" ALTER COLUMN "topup_credits" SET DATA TYPE numeric(12, 4);--> statement-breakpoint
ALTER TABLE "credits" ALTER COLUMN "topup_credits" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "credits" ALTER COLUMN "overage_limit" SET DATA TYPE numeric(12, 4);--> statement-breakpoint
ALTER TABLE "credits" ALTER COLUMN "overage_limit" SET DEFAULT '500';--> statement-breakpoint
ALTER TABLE "credits" ALTER COLUMN "total_credits_consumed" SET DATA TYPE numeric(12, 4);--> statement-breakpoint
ALTER TABLE "credits" ALTER COLUMN "total_credits_consumed" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_id" text;--> statement-breakpoint
ALTER TABLE "email_approved_senders" ADD CONSTRAINT "email_approved_senders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_workspace_addresses" ADD CONSTRAINT "email_workspace_addresses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_email_address_id_email_workspace_addresses_id_fk" FOREIGN KEY ("email_address_id") REFERENCES "public"."email_workspace_addresses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_routed_to_agent_id_agents_id_fk" FOREIGN KEY ("routed_to_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_user_links" ADD CONSTRAINT "slack_user_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_user_links" ADD CONSTRAINT "slack_user_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_user_links" ADD CONSTRAINT "telegram_user_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_user_links" ADD CONSTRAINT "telegram_user_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_agent_access" ADD CONSTRAINT "user_agent_access_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_agent_access" ADD CONSTRAINT "user_agent_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_agent_access" ADD CONSTRAINT "user_agent_access_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_credit_limits" ADD CONSTRAINT "user_credit_limits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_credit_limits" ADD CONSTRAINT "user_credit_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_user_links" ADD CONSTRAINT "whatsapp_user_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_user_links" ADD CONSTRAINT "whatsapp_user_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_google_id_unique" UNIQUE("google_id");