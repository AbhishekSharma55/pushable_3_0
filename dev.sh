#!/bin/bash
# Start development environment with Claude CLI proxy + Docker

set -e

PROXY_PID=""

cleanup() {
    echo ""
    echo "Shutting down..."
    if [ -n "$PROXY_PID" ] && kill -0 "$PROXY_PID" 2>/dev/null; then
        kill "$PROXY_PID" 2>/dev/null
        echo "Claude CLI proxy stopped"
    fi
    docker compose -f docker-compose.dev.yml down
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# Start Claude CLI proxy in background (only if CLAUDE_CLI_PROXY_URL is set)
if grep -q "CLAUDE_CLI_PROXY_URL" .env 2>/dev/null; then
    PROXY_PORT=$(grep CLAUDE_PROXY_PORT .env 2>/dev/null | cut -d= -f2 | tr -d ' ')
    PROXY_PORT=${PROXY_PORT:-4006}

    echo "Starting Claude CLI proxy on port $PROXY_PORT..."
    node scripts/claude-proxy.mjs &
    PROXY_PID=$!
    sleep 1

    if ! kill -0 "$PROXY_PID" 2>/dev/null; then
        echo "ERROR: Claude CLI proxy failed to start"
        exit 1
    fi
    echo "Claude CLI proxy running (PID: $PROXY_PID)"
fi

# Start Docker Compose
echo "Starting Docker services..."
docker compose -f docker-compose.dev.yml up --build
