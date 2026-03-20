CREATE TYPE "public"."vault_audit_action" AS ENUM('connect', 'disconnect', 'credential_fetch', 'token_refresh', 'test', 'error');--> statement-breakpoint
CREATE TYPE "public"."vault_connection_status" AS ENUM('active', 'inactive', 'failed');--> statement-breakpoint
CREATE TYPE "public"."vault_provider" AS ENUM('bitwarden');--> statement-breakpoint
CREATE TABLE "vault_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid,
	"action" "vault_audit_action" NOT NULL,
	"item_name" text,
	"success" boolean NOT NULL,
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" "vault_provider" NOT NULL,
	"encrypted_access_token" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"encrypted_vault_key" text NOT NULL,
	"email" text NOT NULL,
	"kdf_iterations" integer NOT NULL,
	"token_expires_at" timestamp NOT NULL,
	"device_identifier" text NOT NULL,
	"status" "vault_connection_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vault_audit_logs" ADD CONSTRAINT "vault_audit_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_connections" ADD CONSTRAINT "vault_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;