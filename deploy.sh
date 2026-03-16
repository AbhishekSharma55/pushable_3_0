#!/bin/bash
set -e

# Check for port conflicts
for port in 3000 4000; do
  if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
    echo "Port $port is already in use. Stop the local service first."
    echo "You can find the process with: ss -tlnp | grep :${port}"
    exit 1
  fi
done

echo "Starting Pushable AI..."
docker compose -f docker-compose.dev.yml up --build -d

echo ""
echo "Pushable AI is starting up!"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:4000"
echo ""
echo "Run 'docker compose -f docker-compose.dev.yml logs -f' to view logs"
