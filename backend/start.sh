#!/bin/sh
set -e

# Run SQL migrations (idempotent — safe to re-run)
echo "Running migrations..."
pnpm tsx src/db/migrate.ts

# NOTE: drizzle-kit push removed — it was dropping and recreating tables on
# every restart, wiping data. All schema changes are handled by manual
# migrations in src/db/migrations/. Use `drizzle-kit push` manually only
# when you need to sync a one-off schema change during development.

echo "Starting backend..."
exec pnpm run dev
