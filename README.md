# Pushable AI

**A multi-tenant platform for deploying and orchestrating AI agents as virtual employees.**

Pushable AI lets you create configurable AI agents that chat with users, browse the web (real or cloud browsers), search knowledge bases over pgvector, call 1,200+ third-party tools via Composio, run Python in a sandbox, and execute on cron, natural-language, or event-driven schedules — all with per-action credit metering and human-in-the-loop approval.

It is a real, running product. The codebase is **~50 PostgreSQL tables, 36 REST route modules, a ~2,500-line LangGraph agent state machine, 8 Docker services, and 3 Next.js frontends**.

> **For reviewers / interviewers:** start with [`REPO_OVERVIEW.md`](./REPO_OVERVIEW.md) for a one-page map, or [`HIGHLIGHTS.md`](./HIGHLIGHTS.md) for the engineering decisions worth talking about. Deep technical docs live in [`docs/platform/`](./docs/platform/README.md).

---

## Architecture

The platform runs as 8 Docker services:

| Service | Tech | Port | Purpose |
|---------|------|------|---------|
| **backend** | Fastify + LangGraph + TypeScript | 4000 | REST API, agent execution engine, BullMQ workers |
| **frontend** | Next.js 16 + React 19 | 3000 | Main dashboard |
| **admin-panel** | Next.js 16 + React 19 | 3002 | System administration |
| **public-frontend** | Next.js 16 + React 19 | 3001 | Marketing website |
| **browser-service** | Python + FastAPI + Camoufox/Playwright | 8080 | Anti-detect headless browser |
| **extension-bridge** | Node.js + WebSocket | 3004 | Chrome extension relay (user's real browser) |
| **postgres** | PostgreSQL 16 + pgvector | 5432 | Relational data + vector search |
| **redis** | Redis 7 | 6379 | Job queue (BullMQ) |
| **minio** | MinIO (S3-compatible) | 9000 / 9001 | File storage + console |

```
pushable_3_0/
├── backend/              # Fastify API + LangGraph agent engine + BullMQ workers
├── frontend/             # Main dashboard (Next.js)
├── admin-panel/          # Admin control panel (Next.js)
├── public-frontend/      # Marketing website (Next.js)
├── browser-service/      # Browser automation (Python / FastAPI / Camoufox)
├── extension-bridge/     # Chrome extension WebSocket relay
├── extension-v4/         # Chrome extension source
├── cdp-analyzer/         # Python service for Chrome DevTools Protocol analysis
├── camoufox-main/        # Vendored upstream Camoufox build tree (see KNOWN_ISSUES.md)
├── docs/platform/        # 17 deep-dive technical docs
├── REPO_OVERVIEW.md      # One-page map of the codebase
├── HIGHLIGHTS.md         # Engineering decisions worth talking about
├── KNOWN_ISSUES.md       # Tracked rough edges
├── scripts/              # Dev helper scripts (Claude proxy, MCP test, Chrome launcher)
├── docker-compose.dev.yml
├── docker-compose.prod.yml
├── dev.sh                # Development startup script
├── deploy.sh             # Production deployment script
└── env.example           # Environment variable template
```

---

## Quick Start

### Prerequisites

- Docker 24+ and Docker Compose v2+
- Git

### 1. Clone and configure

```bash
git clone <repository-url> pushable_3_0
cd pushable_3_0
cp env.example .env
```

Edit `.env` and set your API keys:

```env
POSTGRES_PASSWORD=your-secure-password
JWT_SECRET=your-32-char-secret-key-here-min
OPENROUTER_KEY=sk-or-v1-your-key-here
```

### 2. Start development environment

```bash
chmod +x dev.sh
./dev.sh
```

Or directly:

```bash
docker compose -f docker-compose.dev.yml up --build
```

### 3. Open the platform

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:3000 |
| Public site | http://localhost:3001 |
| Admin panel | http://localhost:3002 |
| Backend API | http://localhost:4000 |
| MinIO Console | http://localhost:9001 |

Register an account at http://localhost:3000, create a workspace, and start building agents.

---

## Production Deployment

```bash
chmod +x deploy.sh
./deploy.sh
```

The deploy script builds optimized images, starts services in detached mode, and waits for all health checks to pass. See [Deployment docs](./docs/platform/17-deployment.md) for full details.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Fastify 5, TypeScript, LangGraph JS, Drizzle ORM |
| **Frontend** | Next.js 16, React 19, shadcn/ui, Tailwind CSS 4 |
| **Database** | PostgreSQL 16 + pgvector |
| **Queue** | BullMQ + Redis 7 |
| **LLM Gateway** | OpenRouter (Claude, GPT, Gemini, DeepSeek, Llama) |
| **Browser** | Chromium (cloud) + Chrome Extension (real browser) |
| **Storage** | MinIO / AWS S3 |
| **Integrations** | Composio, Slack, Telegram, Bitwarden |

---

## Key Features

### Agent System
- Create AI agents with custom system prompts and LLM model selection
- 18+ LLM models (GPT-5.x, Claude, Gemini, DeepSeek, Llama) via OpenRouter
- Granular permissions: system access, tool access, KB access, agent delegation
- Human-in-the-Loop approval for sensitive operations

### Chat
- Real-time streaming via Server-Sent Events (SSE)
- File attachments (images, PDFs, DOCX, CSV)
- Tool call visualization and debug panel
- Conversation summarization for long chats

### Built-in Agent Tools
- **Browser automation** -- Navigate, click, type, screenshot (cloud or real Chrome)
- **Python sandbox** -- Execute Python code with numpy, pandas, scipy, matplotlib
- **File storage** -- Read, write, list, delete files in workspace bucket
- **Vault** -- Access Bitwarden credentials for automated logins
- **Memory** -- Persistent per-user knowledge storage
- **Planning** -- Internal task management
- **Notebook** -- Persistent scratchpad for working references
- **System tools** -- Manage KBs, skills, tools, schedules, agents

### Knowledge Base (RAG)
- Upload documents (PDF, TXT, Markdown)
- Automatic chunking and vector embedding (pgvector)
- Semantic search across multiple knowledge bases

### Integrations
- **Composio** -- 1200+ third-party toolkits (Google Sheets, Gmail, GitHub, etc.)
- **Slack** -- Bot integration with event handling
- **Telegram** -- Bot integration via webhooks
- **Bitwarden** -- Encrypted credential vault
- **MCP Servers** -- Custom Model Context Protocol tools

### Scheduling
- Cron, natural language ("every weekday morning"), and preset schedules
- Business hours constraints and humanization delays
- Run history with credit tracking

### Credits & Billing
- Per-action credit billing with model-based multipliers
- Plan tiers (Free, Starter, Pro, Scale)
- Full transaction ledger

### Browser Automation
- Cloud browser (headless Chromium with proxy and CAPTCHA support)
- Extension browser (control user's real Chrome via extension)
- Live browser preview in chat

### Admin Panel
- User management (CRUD, block, credits)
- Real-time Docker container monitoring
- Container log viewer
- LLM model configuration
- Browser proxy management

---

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `POSTGRES_PASSWORD` | Database password |
| `JWT_SECRET` | JWT signing secret (min 32 chars) |
| `OPENROUTER_KEY` | OpenRouter API key for LLM access |

### Optional

| Variable | Description |
|----------|-------------|
| `COMPOSIO_API_KEY` | Composio integration platform |
| `CAPSOLVER_API_KEY` | CAPTCHA solving service |
| `VAULT_ENCRYPTION_KEY` | AES key for vault encryption |
| `EXTENSION_BRIDGE_API_KEY` | Chrome extension bridge auth |

See [env.example](./env.example) for the full list.

---

## What's interesting in this codebase

A short index of the parts that are worth a look beyond the feature list:

- [`backend/src/graphs/agent.graph.ts`](./backend/src/graphs/agent.graph.ts) — ~2,500-line LangGraph state machine that drives every conversation: tool dispatch, HITL approval, summarization, streaming.
- [`backend/src/lib/credit-engine.ts`](./backend/src/lib/credit-engine.ts) — event-sourced credit ledger; per-model multipliers; pre-flight budget check.
- [`backend/src/lib/gateway.ts`](./backend/src/lib/gateway.ts) — single abstraction over Claude / GPT / Gemini / DeepSeek / Llama via OpenRouter.
- [`browser-service/src/`](./browser-service/src) — Camoufox-driven anti-detect Firefox automation with proxy + CAPTCHA support.
- [`extension-bridge/`](./extension-bridge) + [`extension-v4/`](./extension-v4) — WebSocket relay that lets the backend automate the user's *real* Chrome browser when bot detection is a problem.
- [`backend/src/db/schema/`](./backend/src/db/schema) — ~50 Drizzle tables; every business table is `workspaceId`-scoped.

For a written walkthrough of the design decisions and trade-offs, see [`HIGHLIGHTS.md`](./HIGHLIGHTS.md).

---

## Database

PostgreSQL 16 with pgvector extension. 33+ tables managed by Drizzle ORM.

```bash
# Generate migrations
cd backend && pnpm db:generate

# Push schema to database
cd backend && pnpm db:push

# Open visual DB browser
cd backend && pnpm db:studio
```

Migrations run automatically on backend startup.

---

## Useful Commands

```bash
# View logs
docker compose -f docker-compose.dev.yml logs -f backend

# Restart a service
docker compose -f docker-compose.dev.yml restart backend

# Stop everything
docker compose -f docker-compose.dev.yml down

# Health check
curl http://localhost:4000/health
```

---

## Documentation

- **Repo overview** — [`REPO_OVERVIEW.md`](./REPO_OVERVIEW.md)
- **Engineering highlights / interview talking points** — [`HIGHLIGHTS.md`](./HIGHLIGHTS.md)
- **Known issues** — [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md)

Full platform documentation is available in [`docs/platform/`](./docs/platform/README.md):

1. [Getting Started](./docs/platform/01-getting-started.md)
2. [Architecture Overview](./docs/platform/02-architecture-overview.md)
3. [Authentication](./docs/platform/03-authentication.md)
4. [Agent System](./docs/platform/04-agent-system.md)
5. [Chat & Conversations](./docs/platform/05-chat-conversations.md)
6. [Agent Tools](./docs/platform/06-agent-tools.md)
7. [Browser Automation](./docs/platform/07-browser-automation.md)
8. [Knowledge Base](./docs/platform/08-knowledge-base.md)
9. [Integrations](./docs/platform/09-integrations.md)
10. [Scheduling](./docs/platform/10-scheduling.md)
11. [Credits & Billing](./docs/platform/11-credits-billing.md)
12. [File Management](./docs/platform/12-file-management.md)
13. [Admin Panel](./docs/platform/13-admin-panel.md)
14. [Public Website](./docs/platform/14-public-website.md)
15. [API Reference](./docs/platform/15-api-reference.md) (150+ endpoints)
16. [Database Schema](./docs/platform/16-database-schema.md) (33+ tables)
17. [Deployment](./docs/platform/17-deployment.md)
