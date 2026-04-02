-- Telegram user links: maps Telegram user IDs to workspaces for the shared platform bot
CREATE TABLE "telegram_user_links" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "telegram_user_id" text NOT NULL UNIQUE,
    "telegram_username" text,
    "telegram_first_name" text,
    "telegram_chat_id" text,
    "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
    "verified_at" timestamp,
    "last_message_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "idx_telegram_links_workspace" ON "telegram_user_links"("workspace_id");
CREATE INDEX "idx_telegram_links_telegram_user_id" ON "telegram_user_links"("telegram_user_id");
