#!/bin/sh
set -e

echo "Running database migrations..."
pnpm drizzle-kit migrate

echo "Starting backend (production)..."
exec pnpm tsx src/index.ts
