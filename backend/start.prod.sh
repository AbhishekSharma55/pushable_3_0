#!/bin/sh
set -e

echo "Pushing database schema..."
pnpm drizzle-kit push --force

echo "Running custom migrations..."
pnpm tsx src/db/migrate.ts

echo "Starting backend (production)..."
exec pnpm tsx src/index.ts
