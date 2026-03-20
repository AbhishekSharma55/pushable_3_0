-- Add metadata JSONB column to messages for storing tool calls and segments
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}' NOT NULL;
