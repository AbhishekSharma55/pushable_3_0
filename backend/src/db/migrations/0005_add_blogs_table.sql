CREATE TABLE IF NOT EXISTS "blogs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "title" text NOT NULL,
    "slug" text NOT NULL,
    "description" text,
    "content" text NOT NULL,
    "emoji" text,
    "tag" text,
    "cover_image" text,
    "author" text,
    "read_time" text,
    "featured" boolean DEFAULT false NOT NULL,
    "published" boolean DEFAULT false NOT NULL,
    "published_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
