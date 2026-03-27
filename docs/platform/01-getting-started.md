# Getting Started

This guide walks you through setting up the Pushable AI platform from scratch for local development and production deployment.

---

## Prerequisites

Before you begin, ensure the following are installed on your machine:

| Tool | Version | Purpose |
|------|---------|---------|
| **Docker** | 24+ | Container runtime for all services |
| **Docker Compose** | v2+ | Multi-service orchestration |
| **Git** | 2.30+ | Version control |
| **Node.js** | 20+ | Required only if running services outside Docker |
| **pnpm** | 10.26+ | Package manager (backend and extension-bridge) |
| **Python** | 3.11+ | Required only for browser-service outside Docker |

---

## Project Structure

```
pushable_3_0/
├── backend/              # Fastify API server (Node.js)
├── frontend/             # Main dashboard (Next.js)
├── admin-panel/          # Admin control panel (Next.js)
├── public-frontend/      # Marketing/public website (Next.js)
├── browser-service/      # Browser automation (Python/Flask)
├── extension-bridge/     # Chrome extension WebSocket relay (Node.js)
├── pushable-relay/       # Chrome extension source files
├── docker-compose.dev.yml
├── docker-compose.prod.yml
├── dev.sh                # Development startup script
├── deploy.sh             # Production deployment script
├── env.example           # Environment variable template
└── .env                  # Your local configuration (create from env.example)
```

---

## 1. Clone the Repository

```bash
git clone <repository-url> pushable_3_0
cd pushable_3_0
```

---

## 2. Configure Environment Variables

Copy the example environment file and fill in the required values:

```bash
cp env.example .env
```

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `POSTGRES_USER` | PostgreSQL username | `postgres` |
| `POSTGRES_PASSWORD` | PostgreSQL password | `your-secure-password` |
| `POSTGRES_DB` | Database name | `pushable_ai` |
| `JWT_SECRET` | Secret for signing JWT tokens (min 32 characters) | `pushable-ai-super-secret-jwt-key-32chars` |
| `OPENROUTER_KEY` | OpenRouter API key for LLM access | `sk-or-v1-...` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `COMPOSIO_API_KEY` | Composio API key for third-party integrations | _(empty)_ |
| `CAPSOLVER_API_KEY` | Capsolver API key for CAPTCHA solving | _(empty)_ |
| `CAPSOLVER_EXTENSION_ENABLED` | Enable CAPTCHA solving in browser automation | `true` |
| `VAULT_ENCRYPTION_KEY` | AES key for encrypting vault credentials | _(empty)_ |
| `EXTENSION_BRIDGE_API_KEY` | API key for Chrome extension bridge | _(empty)_ |

### URL Configuration

For **local development**, the defaults work out of the box. For **production**, update these:

```env
# Production URLs (update to your domain)
FRONTEND_URL=https://platform.yourdomain.com
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
NEXT_PUBLIC_BROWSER_WS_URL=wss://browser.yourdomain.com
NEXT_PUBLIC_FRONTEND_URL=https://platform.yourdomain.com
EXTENSION_BRIDGE_PUBLIC_URL=wss://ws.yourdomain.com
```

### Port Configuration

All ports have sensible defaults. Override only if there are conflicts:

```env
FRONTEND_PORT=3000
PUBLIC_FRONTEND_PORT=3001
ADMIN_PANEL_PORT=3002
BACKEND_PORT=4000
BROWSER_SERVICE_PORT=8080
```

---

## 3. Start Development Environment

The simplest way to start everything:

```bash
chmod +x dev.sh
./dev.sh
```

This script:
1. Optionally starts the Claude CLI proxy (if `CLAUDE_CLI_PROXY_URL` is set in `.env`)
2. Runs `docker compose -f docker-compose.dev.yml up --build`
3. Mounts source directories as volumes for hot-reload

Alternatively, run Docker Compose directly:

```bash
docker compose -f docker-compose.dev.yml up --build
```

### What Happens on First Start

When the backend starts, it automatically:
1. **Runs database migrations** -- creates all tables in PostgreSQL
2. **Seeds LLM models** -- populates 18+ models (GPT-5.x, Claude, Gemini)
3. **Seeds proxy configurations** -- adds default browser proxies
4. **Starts BullMQ workers** -- initializes the schedule job processor
5. **Initializes the scheduler** -- loads enabled cron schedules
6. **Activates channel connections** -- initializes active Slack/Telegram bots

### Services After Startup

| Service | URL | Purpose |
|---------|-----|---------|
| **Frontend** | http://localhost:3000 | Main platform dashboard |
| **Public Frontend** | http://localhost:3001 | Marketing website |
| **Admin Panel** | http://localhost:3002 | System administration |
| **Backend API** | http://localhost:4000 | REST API server |
| **Browser Service** | http://localhost:8080 | Browser automation |
| **Extension Bridge** | ws://localhost:3004 | Chrome extension relay |
| **MinIO Console** | http://localhost:9001 | File storage admin (user: `minioadmin` / pass: `minioadmin`) |
| **PostgreSQL** | localhost:5432 | Database (connect via any PG client) |

---

## 4. Create Your First Account

1. Open http://localhost:3000 in your browser
2. Click **Register** and create an account (name, email, password)
3. On first login, you'll be redirected to the **Onboarding** page to create your first workspace
4. Once the workspace is created, you'll land on the **Virtual HQ** dashboard

---

## 5. Production Deployment

### Using the Deploy Script

```bash
chmod +x deploy.sh
./deploy.sh
```

The deploy script:
1. Validates Docker is installed and running
2. Loads `.env` and sets defaults for any missing variables
3. Checks for port conflicts before starting
4. Builds all services in parallel using `Dockerfile.prod` files
5. Starts containers in detached mode
6. Waits for each service to report healthy
7. Prints a summary of all running service URLs

### Manual Production Deployment

```bash
docker compose -f docker-compose.prod.yml build --parallel
docker compose -f docker-compose.prod.yml up -d
```

### Key Differences: Dev vs Production

| Aspect | Development | Production |
|--------|-------------|------------|
| Docker files | `Dockerfile` | `Dockerfile.prod` |
| Compose file | `docker-compose.dev.yml` | `docker-compose.prod.yml` |
| Source volumes | Mounted for hot-reload | Not mounted (built into image) |
| NODE_ENV | _(unset)_ | `production` |
| Next.js output | Standard | `standalone` (optimized) |
| Ports exposed | Postgres (5432) exposed | Postgres not exposed externally |
| MinIO | Ports 9000/9001 exposed | Configurable via env |
| Browser profiles | Local directory mount | Named Docker volumes |
| Admin panel | Docker socket mounted | Docker socket mounted |

---

## 6. Useful Commands

### Logs

```bash
# All services
docker compose -f docker-compose.dev.yml logs -f

# Specific service
docker compose -f docker-compose.dev.yml logs -f backend
docker compose -f docker-compose.dev.yml logs -f frontend
```

### Stop

```bash
docker compose -f docker-compose.dev.yml down
```

### Restart a Single Service

```bash
docker compose -f docker-compose.dev.yml restart backend
```

### Rebuild a Single Service

```bash
docker compose -f docker-compose.dev.yml up --build backend
```

### Database Operations

The backend uses Drizzle ORM. Run these from within the `backend/` directory:

```bash
# Generate migrations from schema changes
pnpm db:generate

# Push schema directly to database (dev only)
pnpm db:push

# Run migrations
pnpm db:migrate

# Open Drizzle Studio (visual DB browser)
pnpm db:studio
```

### Health Check

```bash
curl http://localhost:4000/health
# Expected: {"status":"ok"}
```

---

## 7. Troubleshooting

### Port Already in Use

```bash
# Find what's using a port
ss -tlnp | grep :4000
# Or
lsof -i :4000
```

### Database Connection Issues

Ensure PostgreSQL is healthy:

```bash
docker compose -f docker-compose.dev.yml exec postgres pg_isready -U postgres
```

### Backend Won't Start

Check that PostgreSQL and Redis are healthy first (the backend depends on both):

```bash
docker compose -f docker-compose.dev.yml ps
docker compose -f docker-compose.dev.yml logs backend --tail 50
```

### Frontend Shows "Loading workspace..."

This usually means the backend API is unreachable. Verify:
- Backend is running on port 4000
- `NEXT_PUBLIC_API_URL` is set correctly
- CORS is allowing your frontend origin

### MinIO Bucket Not Created

The backend auto-creates the bucket on first file upload. You can also create it manually via the MinIO Console at http://localhost:9001.

---

## Next Steps

- [Architecture Overview](./02-architecture-overview.md) -- Understand how all services connect
- [Authentication](./03-authentication.md) -- Deep dive into the auth system
