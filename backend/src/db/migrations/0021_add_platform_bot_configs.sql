CREATE TABLE IF NOT EXISTS platform_bot_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL UNIQUE,
  config jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'inactive',
  bot_name text,
  bot_username text,
  error_message text,
  updated_at timestamp DEFAULT now() NOT NULL,
  updated_by text
);
