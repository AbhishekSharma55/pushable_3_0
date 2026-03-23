#!/bin/sh
set -e

# Run custom SQL migrations FIRST to fix schema alignment issues
# (drops old enums/columns that cause drizzle-kit push to prompt interactively)
echo "Running custom migrations..."
pnpm tsx src/db/migrate.ts

echo "Pushing database schema..."
pnpm drizzle-kit push --force

echo "Starting backend (production)..."
exec pnpm tsx src/index.ts
