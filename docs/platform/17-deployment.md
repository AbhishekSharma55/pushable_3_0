# Deployment

This document covers Docker-based deployment for both development and production environments, including all service configurations, environment variables, and operational commands.

---

## Docker Compose Files

| File | Purpose |
|------|---------|
| `docker-compose.dev.yml` | Development with hot-reload (source volumes mounted) |
| `docker-compose.prod.yml` | Production with optimized builds (no source mounts) |

---

## Services

Both environments run the same 8 services:

| Service | Image / Build | Internal Port | External Port |
|---------|--------------|---------------|---------------|
| **postgres** | `pgvector/pgvector:pg16` | 5432 | 5432 (dev) / none (prod) |
| **redis** | `redis:7-alpine` | 6379 | none |
| **minio** | `minio/minio:latest` | 9000, 9001 | 9000, 9001 |
| **backend** | `./backend` | 4000 | 4000 |
| **browser-service** | `./browser-service` | 8080 | 8080 |
| **frontend** | `./frontend` | 3000 | 3000 |
| **public-frontend** | `./public-frontend` | 3001 | 3001 |
| **extension-bridge** | `./extension-bridge` | 3001 | 3004 |
| **admin-panel** | `./admin-panel` | 3002 | 3002 |

---

## Development Setup

### Quick Start

```bash
# 1. Clone and configure
cp env.example .env
# Edit .env with your API keys

# 2. Start everything
chmod +x dev.sh
./dev.sh

# Or directly:
docker compose -f docker-compose.dev.yml up --build
```

### Development Features

- **Hot-reload:** Source directories mounted as volumes (`./backend/src:/app/src`, etc.)
- **Exposed ports:** PostgreSQL (5432) accessible for local tools
- **DNS:** Google DNS (8.8.8.8, 8.8.4.4) configured for backend
- **Host access:** `host.docker.internal` mapped for backend-to-host communication

### dev.sh Script

The development startup script:
1. Optionally starts Claude CLI proxy (if `CLAUDE_CLI_PROXY_URL` is set)
2. Runs `docker compose -f docker-compose.dev.yml up --build`
3. Traps SIGINT/SIGTERM for graceful shutdown

---

## Production Deployment

### Quick Start

```bash
chmod +x deploy.sh
./deploy.sh
```

### deploy.sh Script

The production deployment script:

1. **Validates** Docker is installed and running
2. **Loads** `.env` file (or uses defaults)
3. **Sets defaults** for any missing variables
4. **Checks ports** for conflicts (skips if already owned by Docker)
5. **Prints** configuration summary
6. **Builds** all services in parallel (`docker compose build --parallel`)
7. **Starts** containers in detached mode
8. **Health checks** each service in order:
   - PostgreSQL (pg_isready, 30 attempts)
   - Redis (redis-cli ping, 15 attempts)
   - MinIO (health endpoint, 30 attempts)
   - Backend (/health endpoint, 60 attempts)
   - Browser Service (/health, 30 attempts)
   - Frontend (HTTP check, 60 attempts)
   - Public Frontend (HTTP check, 60 attempts)
   - Admin Panel (HTTP check, 60 attempts)
9. **Prints** final status with all service URLs

### Production Differences

| Aspect | Development | Production |
|--------|-------------|------------|
| Dockerfiles | `Dockerfile` | `Dockerfile.prod` |
| Source volumes | Mounted | Not mounted (built into image) |
| NODE_ENV | unset | `production` |
| Next.js output | Standard | `standalone` (optimized) |
| PostgreSQL port | 5432 exposed | Not exposed externally |
| Build args | None | `NEXT_PUBLIC_*` vars baked in |
| Browser profiles | Local directory | Named Docker volumes |
| Cookie security | Default | `ADMIN_COOKIE_SECURE=true` |

---

## Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `POSTGRES_USER` | Database username | `postgres` |
| `POSTGRES_PASSWORD` | Database password | `your-secure-password` |
| `POSTGRES_DB` | Database name | `pushable_ai` |
| `JWT_SECRET` | JWT signing secret (min 32 chars) | `your-32-char-secret` |
| `OPENROUTER_KEY` | OpenRouter API key | `sk-or-v1-...` |

### Optional API Keys

| Variable | Description | Default |
|----------|-------------|---------|
| `COMPOSIO_API_KEY` | Composio integration platform | _(empty)_ |
| `CAPSOLVER_API_KEY` | CAPTCHA solving service | _(empty)_ |
| `ANTHROPIC_API_KEY` | Direct Anthropic API access | _(empty)_ |
| `VAULT_ENCRYPTION_KEY` | AES key for vault credential encryption | _(empty)_ |
| `EXTENSION_BRIDGE_API_KEY` | Chrome extension bridge auth | _(empty)_ |

### URL Configuration

| Variable | Dev Default | Prod Default |
|----------|-------------|-------------|
| `FRONTEND_URL` | `http://localhost:3000` | `https://platform.pushable.ai` |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | `https://api.pushable.ai` |
| `NEXT_PUBLIC_BROWSER_WS_URL` | `ws://localhost:8080` | `wss://browser.pushable.ai` |
| `NEXT_PUBLIC_FRONTEND_URL` | `http://localhost:3000` | `https://platform.pushable.ai` |
| `EXTENSION_BRIDGE_PUBLIC_URL` | `ws://localhost:3004` | `wss://ws.pushable.ai` |

### Port Overrides

| Variable | Default |
|----------|---------|
| `FRONTEND_PORT` | 3000 |
| `PUBLIC_FRONTEND_PORT` | 3001 |
| `ADMIN_PANEL_PORT` | 3002 |
| `BACKEND_PORT` | 4000 |
| `BROWSER_SERVICE_PORT` | 8080 |
| `EXTENSION_BRIDGE_PORT` | 3004 |
| `MINIO_API_PORT` | 9000 |
| `MINIO_CONSOLE_PORT` | 9001 |

### Storage

| Variable | Default | Description |
|----------|---------|-------------|
| `MINIO_ROOT_USER` | `minioadmin` | MinIO access key |
| `MINIO_ROOT_PASSWORD` | `minioadmin` | MinIO secret key |
| `S3_BUCKET` | `pushable-bucket` | Default bucket name |
| `S3_REGION` | `us-east-1` | AWS region |

### Admin Panel

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_SECRET` | `pushable-admin-secret-key-change-in-prod` | Admin JWT secret |
| `ADMIN_COOKIE_SECURE` | `true` (prod) | Secure cookie flag |

### Email

| Variable | Default | Description |
|----------|---------|-------------|
| `EMAIL_DOMAIN` | _(empty)_ | Domain for workspace email addresses (e.g. `mydomain.com`) |
| `EMAIL_WEBHOOK_SECRET` | _(empty)_ | Optional shared secret for Cloudflare webhook verification |

### Feature Flags

| Variable | Default | Description |
|----------|---------|-------------|
| `CAPSOLVER_EXTENSION_ENABLED` | `true` | Enable CAPTCHA solving |
| `NEXT_PUBLIC_LOGGING` | `false` | Enable frontend debug logging |
| `MAX_BUCKET_STORAGE_MB` | `500` | Max file storage per workspace |

---

## Docker Volumes

| Volume | Service | Purpose |
|--------|---------|---------|
| `pgdata` | postgres | Database files |
| `redisdata` | redis | Queue persistence |
| `minio-data` | minio | File storage |
| `bw-data` | backend | Bitwarden session data |
| `browser_profiles` | browser-service | Browser profiles (prod only) |
| `browser_extensions` | browser-service | Browser extensions (prod only) |

---

## Service Dependencies

```
postgres (health: pg_isready)
  └── backend
  └── admin-panel

redis (health: redis-cli ping)
  └── backend

minio (health: mc ready local)
  └── backend

backend
  └── frontend
  └── public-frontend
  └── extension-bridge
  └── admin-panel
```

Services wait for their dependencies to be healthy before starting (`condition: service_healthy`).

---

## Backend Startup Sequence

When the backend container starts:

1. Listen on port 4000
2. Clean up stale browser sessions
3. Run database migrations (`src/db/migrate.ts`)
4. Seed LLM models (18+ models via upsert)
5. Seed proxy configurations
6. Start BullMQ workers (schedule processor)
7. Initialize cron scheduler (load enabled schedules)
8. Initialize active channel connections (Slack/Telegram bots)

In development, the `start.sh` script also runs `drizzle-kit push` to sync schema.

---

## Operational Commands

### View Logs

```bash
# All services
docker compose -f docker-compose.dev.yml logs -f

# Specific service
docker compose -f docker-compose.dev.yml logs -f backend

# Last 100 lines
docker compose -f docker-compose.dev.yml logs --tail 100 backend
```

### Stop All Services

```bash
docker compose -f docker-compose.dev.yml down

# With volume cleanup (DESTROYS DATA)
docker compose -f docker-compose.dev.yml down -v
```

### Restart a Service

```bash
docker compose -f docker-compose.dev.yml restart backend
```

### Rebuild and Restart

```bash
docker compose -f docker-compose.dev.yml up --build backend
```

### Database Operations

```bash
# From host (if pg tools installed)
psql postgresql://postgres:password@localhost:5432/pushable_ai

# Via Docker
docker compose -f docker-compose.dev.yml exec postgres psql -U postgres pushable_ai

# Drizzle Studio (visual DB browser)
cd backend && pnpm db:studio
```

### Health Checks

```bash
# Backend
curl http://localhost:4000/health

# MinIO
curl http://localhost:9000/minio/health/live

# Browser service
curl http://localhost:8080/health
```

---

## Reverse Proxy (Production)

For production, place a reverse proxy (nginx, Caddy, Traefik) in front of the services:

### Example Domain Mapping

| Domain | Service | Port |
|--------|---------|------|
| `platform.pushable.ai` | frontend | 3000 |
| `pushable.ai` | public-frontend | 3001 |
| `api.pushable.ai` | backend | 4000 |
| `admin.pushable.ai` | admin-panel | 3002 |
| `browser.pushable.ai` | browser-service | 8080 (WebSocket) |
| `ws.pushable.ai` | extension-bridge | 3004 (WebSocket) |

### SSL/TLS

All production URLs should use HTTPS/WSS. Configure SSL certificates on the reverse proxy.

### WebSocket Support

Both `browser.pushable.ai` and `ws.pushable.ai` require WebSocket upgrade support in the reverse proxy configuration.

---

## Graceful Shutdown

The backend handles SIGTERM and SIGINT signals:

1. Stop BullMQ workers
2. Close the schedule queue
3. Close the Fastify server
4. Exit process

```typescript
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

---

## Monitoring

The admin panel provides built-in monitoring:

- **System stats:** CPU, memory, uptime via Docker socket
- **Container stats:** Per-container CPU, memory, network, disk I/O
- **Container logs:** Real-time log viewing with filtering
- **Platform stats:** Users, agents, sessions, credit usage
- **Run history:** Agent execution logs with status

Access at `http://localhost:3002/monitoring`.
