CREATE TABLE IF NOT EXISTS "contact_submissions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL,
    "email" text NOT NULL,
    "subject" text NOT NULL,
    "message" text NOT NULL,
    "status" text NOT NULL DEFAULT 'new',
    "notes" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
