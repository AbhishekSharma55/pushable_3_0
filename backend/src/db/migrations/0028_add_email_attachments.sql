-- Add attachments JSONB column to inbound_emails
ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb NOT NULL;
-- Add bcc column
ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS bcc text;
