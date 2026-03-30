#!/bin/sh
set -e

# Run SQL migrations (idempotent — safe to re-run)
echo "Running migrations..."
pnpm tsx src/db/migrate.ts

echo "Starting backend (production)..."
exec pnpm tsx src/index.ts
