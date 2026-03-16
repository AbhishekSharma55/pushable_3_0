#!/bin/sh
set -e

echo "Pushing database schema..."
pnpm drizzle-kit push --force

echo "Starting backend (production)..."
exec pnpm tsx src/index.ts
