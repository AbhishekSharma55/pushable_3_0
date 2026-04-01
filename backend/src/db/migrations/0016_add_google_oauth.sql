-- Make password_hash nullable for OAuth users
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- Add google_id column
ALTER TABLE "users" ADD COLUMN "google_id" text UNIQUE;
