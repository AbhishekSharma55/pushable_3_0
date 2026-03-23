#!/bin/sh
set -e

# Run custom SQL migrations first to align schema
echo "Running custom migrations..."
pnpm tsx src/db/migrate.ts

echo "Pushing database schema..."
yes | pnpm drizzle-kit push --force

echo "Starting backend..."
exec pnpm run dev
