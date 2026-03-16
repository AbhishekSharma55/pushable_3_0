#!/bin/bash
set -e

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env"

# ─── Colors ───
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "  ╔═══════════════════════════════════╗"
echo "  ║       Pushable AI — Deploy        ║"
echo "  ╚═══════════════════════════════════╝"
echo -e "${NC}"

# ─── Check Docker ───
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker is not installed. Please install Docker first.${NC}"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo -e "${RED}Docker daemon is not running. Please start Docker.${NC}"
    exit 1
fi

# ─── Load .env if it exists ───
if [ -f "$ENV_FILE" ]; then
    echo -e "${GREEN}Loading environment from .env${NC}"
    set -a
    source "$ENV_FILE"
    set +a
else
    echo -e "${YELLOW}No .env file found — using defaults${NC}"
fi

# ─── Set defaults for any missing vars ───
export POSTGRES_USER="${POSTGRES_USER:-postgres}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-abhishek0003}"
export POSTGRES_DB="${POSTGRES_DB:-pushable_ai}"
export JWT_SECRET="${JWT_SECRET:-pushable-ai-super-secret-jwt-key-32chars}"
export OPENROUTER_KEY="${OPENROUTER_KEY:-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}"
export COMPOSIO_API_KEY="${COMPOSIO_API_KEY:-ak_sYMIgmVF81jyVXtDGmWQ}"
export CAPSOLVER_API_KEY="${CAPSOLVER_API_KEY:-CAP-EE4E7B31B78FB28FB7488B481872E8EF41ED238F170D21EF8420588FFEC5D2F5}"
export CAPSOLVER_EXTENSION_ENABLED="${CAPSOLVER_EXTENSION_ENABLED:-true}"
export FRONTEND_URL="${FRONTEND_URL:-http://localhost:3000}"
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:4000}"
export NEXT_PUBLIC_BROWSER_WS_URL="${NEXT_PUBLIC_BROWSER_WS_URL:-ws://localhost:8080}"
export FRONTEND_PORT="${FRONTEND_PORT:-3000}"
export BACKEND_PORT="${BACKEND_PORT:-4000}"
export BROWSER_SERVICE_PORT="${BROWSER_SERVICE_PORT:-8080}"

# ─── Check port conflicts ───
echo -e "${CYAN}Checking ports...${NC}"
PORTS=("$FRONTEND_PORT" "$BACKEND_PORT" "$BROWSER_SERVICE_PORT")
NAMES=("Frontend" "Backend" "Browser Service")
for i in "${!PORTS[@]}"; do
    port="${PORTS[$i]}"
    name="${NAMES[$i]}"
    if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
        # Check if it's our own container
        container=$(docker ps --filter "publish=${port}" --format '{{.Names}}' 2>/dev/null)
        if [ -z "$container" ]; then
            echo -e "${RED}Port ${port} (${name}) is already in use by another process.${NC}"
            echo "  Find it with: ss -tlnp | grep :${port}"
            exit 1
        fi
    fi
done
echo -e "${GREEN}Ports available${NC}"

# ─── Print config ───
echo ""
echo -e "${CYAN}Configuration:${NC}"
echo "  Frontend:        http://localhost:${FRONTEND_PORT}"
echo "  Backend:         http://localhost:${BACKEND_PORT}"
echo "  Browser Service: http://localhost:${BROWSER_SERVICE_PORT}"
echo "  Database:        ${POSTGRES_DB} (${POSTGRES_USER}@postgres)"
echo "  Capsolver:       ${CAPSOLVER_EXTENSION_ENABLED}"
echo ""

# ─── Build and deploy ───
echo -e "${CYAN}Building and starting services...${NC}"
echo ""

docker compose -f "$COMPOSE_FILE" build --parallel 2>&1 | tail -20

echo ""
echo -e "${CYAN}Starting containers...${NC}"

docker compose -f "$COMPOSE_FILE" up -d

echo ""

# ─── Wait for health ───
echo -e "${CYAN}Waiting for services to be healthy...${NC}"

# Wait for postgres
for i in $(seq 1 30); do
    if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U "$POSTGRES_USER" &>/dev/null; then
        echo -e "  ${GREEN}Postgres ready${NC}"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo -e "  ${RED}Postgres failed to start${NC}"
        docker compose -f "$COMPOSE_FILE" logs postgres --tail 10
        exit 1
    fi
    sleep 1
done

# Wait for redis
for i in $(seq 1 15); do
    if docker compose -f "$COMPOSE_FILE" exec -T redis redis-cli ping &>/dev/null; then
        echo -e "  ${GREEN}Redis ready${NC}"
        break
    fi
    sleep 1
done

# Wait for backend
for i in $(seq 1 60); do
    if curl -sf "http://localhost:${BACKEND_PORT}/health" &>/dev/null; then
        echo -e "  ${GREEN}Backend ready${NC}"
        break
    fi
    if [ "$i" -eq 60 ]; then
        echo -e "  ${YELLOW}Backend still starting (check logs)${NC}"
    fi
    sleep 1
done

# Wait for browser-service
for i in $(seq 1 30); do
    if curl -sf "http://localhost:${BROWSER_SERVICE_PORT}/health" &>/dev/null; then
        echo -e "  ${GREEN}Browser Service ready${NC}"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo -e "  ${YELLOW}Browser Service still starting (check logs)${NC}"
    fi
    sleep 1
done

# Wait for frontend
for i in $(seq 1 60); do
    if curl -sf "http://localhost:${FRONTEND_PORT}" &>/dev/null; then
        echo -e "  ${GREEN}Frontend ready${NC}"
        break
    fi
    if [ "$i" -eq 60 ]; then
        echo -e "  ${YELLOW}Frontend still starting (check logs)${NC}"
    fi
    sleep 1
done

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║       Pushable AI is running!             ║${NC}"
echo -e "${GREEN}╠═══════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Frontend:  http://localhost:${FRONTEND_PORT}          ║${NC}"
echo -e "${GREEN}║  Backend:   http://localhost:${BACKEND_PORT}          ║${NC}"
echo -e "${GREEN}║  Browser:   http://localhost:${BROWSER_SERVICE_PORT}          ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo "  Logs:    docker compose -f $COMPOSE_FILE logs -f"
echo "  Stop:    docker compose -f $COMPOSE_FILE down"
echo "  Restart: docker compose -f $COMPOSE_FILE restart"
echo ""
