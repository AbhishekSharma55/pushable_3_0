# Architecture Overview

Pushable AI is a multi-service platform for deploying and managing AI agents. This document explains how all services connect, communicate, and what role each plays.

---

## High-Level Architecture

```
                                    ┌──────────────────┐
                                    │  Public Frontend │ :3001
                                    │  (Next.js 16)    │
                                    │  Marketing site  │
                                    └──────────────────┘

┌──────────────────┐    REST/WS     ┌──────────────────┐     SQL      ┌──────────────────┐
│    Frontend      │ ──────────────>│    Backend API   │ ───────────> │   PostgreSQL     │
│   (Next.js 16)   │    :4000       │   (Fastify 5)    │              │  (pgvector/pg16) │
│   :3000          │                │                  │              │   :5432          │
└──────────────────┘                │  LangGraph       │              └──────────────────┘
                                    │  Agent Engine    │
┌──────────────────┐    REST        │                  │     Jobs     ┌──────────────────┐
│   Admin Panel    │ ──────────────>│  Drizzle ORM     │ ───────────> │     Redis        │
│  (Next.js 16)    │  + Direct DB   │                  │   (BullMQ)   │   (7-alpine)     │
│  :3002           │                │  BullMQ Workers  │              │                  │
└──────────────────┘                └──────────────────┘              └──────────────────┘
                                         │       │
                              HTTP       │       │    WebSocket
                         ┌───────────────┘       └─────────────────┐
                         ▼                                         ▼
                  ┌──────────────────┐                   ┌──────────────────┐
                  │  Browser Service │                   │ Extension Bridge │
                  │  (Python/Flask)  │                   │ (Node.js/WS)     │
                  │  :8080           │                   │ :3004            │
                  │  Chromium mgmt   │                   │                  │
                  └──────────────────┘                   └──────────────────┘
                                                                  │
                                                           WebSocket
                                                                  ▼
                                                        ┌──────────────────┐
                                                        │  Chrome Extension│
                                                        │ (pushable-relay) │
                                                        │  User's browser  │
                                                        └──────────────────┘

                  ┌──────────────────┐
                  │      MinIO       │
                  │  (S3-compatible) │
                  │  :9000 API       │
                  │  :9001 Console   │
                  └──────────────────┘
```

---

## Service Descriptions

### 1. Backend API (`backend/`)

**Tech:** Fastify 5.8.2, TypeScript, LangGraph JS, Drizzle ORM

The central service that handles all business logic:

- **REST API** -- 23 route files providing endpoints for agents, chat, knowledge base, tools, schedules, integrations, billing, and more
- **Agent execution engine** -- LangGraph state machine that orchestrates AI agent conversations with tool calling, memory, and approval flows
- **Job queue** -- BullMQ workers for processing scheduled agent runs
- **Channel manager** -- Initializes and manages Slack/Telegram bot connections
- **Webhook receiver** -- Handles incoming webhooks from Slack and Telegram

**Internal architecture:**

```
Routes (API endpoints)
  └── Services (business logic)
        └── Repositories (data access via Drizzle ORM)
              └── Database (PostgreSQL)
```

**Key files:**
| File | Purpose |
|------|---------|
| `src/index.ts` | Server entry point, plugin registration, startup sequence |
| `src/graphs/agent.graph.ts` | LangGraph agent execution graph (2300+ lines) |
| `src/lib/gateway.ts` | LLM provider abstraction layer |
| `src/lib/credit-engine.ts` | Credit tracking and billing |
| `src/lib/scheduler.ts` | Cron schedule management |
| `src/lib/queue.ts` | BullMQ queue configuration |
| `src/lib/workers.ts` | Background job workers |

**Startup sequence:**
1. Register Fastify plugins (CORS, JWT, multipart)
2. Register all API routes
3. Listen on port 4000
4. Clean up stale browser sessions
5. Run database migrations
6. Seed LLM models and proxy configurations
7. Start BullMQ workers
8. Initialize cron scheduler
9. Initialize active channel connections (Slack/Telegram bots)

### 2. Frontend (`frontend/`)

**Tech:** Next.js 16.1.6, React 19.2, shadcn/ui, Tailwind CSS 4

The main user-facing dashboard:

- **Authentication** -- Login/register forms, JWT token management
- **Virtual HQ** -- Animated office visualization of AI agents
- **Agent management** -- Create, configure, and assign permissions to agents
- **Chat interface** -- Real-time WebSocket chat with streaming responses
- **Knowledge base** -- Upload documents, view chunks, manage KB collections
- **Tools/skills** -- Create and manage MCP tools and instruction-based skills
- **Schedules** -- Create cron-based agent schedules
- **Integrations** -- Connect Composio toolkits, Slack, Telegram
- **File management** -- Upload, download, and preview files
- **Credits** -- Usage tracking and billing dashboard

**Communication with backend:**
- REST API calls via Axios (`src/lib/api/client.ts`)
- WebSocket for real-time chat (`src/hooks/useChatWs.ts`)
- WebSocket for browser automation preview

### 3. Admin Panel (`admin-panel/`)

**Tech:** Next.js 16.2.0, React 19.2, shadcn/ui

System administration dashboard with elevated access:

- **User management** -- View, block/activate users, manage credits
- **System monitoring** -- Real-time CPU, memory, Docker container stats (via Docker socket)
- **Container logs** -- Stream and view logs from any running container
- **Global tools** -- Manage platform-wide tool configurations
- **LLM settings** -- Configure available models and providers
- **Browser proxies** -- Manage proxy pool and browser profiles

**Special access:** The admin panel mounts the Docker socket (`/var/run/docker.sock`) to read container stats and logs directly.

**Authentication:** Separate auth system using `jose` library (not shared with main frontend auth).

### 4. Public Frontend (`public-frontend/`)

**Tech:** Next.js 16.2.0, React 19.2

Marketing and information website:

- Landing page with feature showcases
- Pricing page
- Blog with SSG (static generation) and ISR (1-hour revalidation)
- Contact form
- Documentation page
- Legal pages (privacy, terms)

**Data fetching:** Fetches blog content and contact form submissions via the backend API. Blog posts use `generateStaticParams()` for build-time generation.

### 5. Browser Service (`browser-service/`)

**Tech:** Python, Flask, Chromium

Headless browser management for AI agent web automation:

- **Browser instance management** -- Create, destroy, and manage Chromium instances
- **DOM extraction** -- Parse page elements for agent navigation
- **Input simulation** -- Click, type, scroll, and interact with web pages
- **Screenshot capture** -- Periodic screenshots at configurable intervals (200ms default, 60% quality)
- **CAPTCHA solving** -- Capsolver extension integration
- **Session persistence** -- Browser profiles with cookies and settings
- **WebSocket streaming** -- Real-time screenshot/state updates to frontend

**Configuration:**
- `SCREENSHOT_INTERVAL_MS=200` -- Capture frequency
- `SCREENSHOT_QUALITY=60` -- JPEG quality
- `SCREENSHOT_WIDTH=1920` / `SCREENSHOT_HEIGHT=1080` -- Resolution

### 6. Extension Bridge (`extension-bridge/`)

**Tech:** Node.js, WebSocket (ws library)

WebSocket relay server connecting Chrome extensions to the backend:

- Acts as a bridge between the `pushable-relay` Chrome extension running in a user's browser and the backend API
- Enables "extension browser mode" where agents control a real browser instead of a cloud Chromium instance
- Communicates with the backend over internal WebSocket (`ws://extension-bridge:3001`)
- Exposed publicly via `EXTENSION_BRIDGE_PUBLIC_URL` for extension connections

### 7. Chrome Extension (`pushable-relay/`)

A Chrome extension (Manifest V3) that:

- Connects to the extension bridge via WebSocket
- Receives automation commands from AI agents
- Executes commands in the user's actual browser
- Sends back page state, screenshots, and results

**Files:** `manifest.json`, `background.js`, `content.js`, `popup.js`

---

## Database Layer

### PostgreSQL + pgvector

**Image:** `pgvector/pgvector:pg16`

The database stores all platform data across 33 tables. The `pgvector` extension enables vector similarity search for the knowledge base (RAG) feature.

**ORM:** Drizzle ORM 0.45.1 with PostgreSQL dialect

**Schema organization** (`backend/src/db/schema/`):

| Category | Tables | Description |
|----------|--------|-------------|
| Users & Workspaces | `users`, `workspaces`, `workspace_members` | Multi-tenant user management |
| Agents | `agents`, `agent_permissions`, `agent_integrations`, `agent_memories` | AI agent configuration and state |
| Chat | `sessions`, `messages`, `runs` | Conversation history and execution tracking |
| Knowledge Base | `knowledge_bases`, `kb_documents`, `kb_chunks` | Documents with vector embeddings |
| Tools & Skills | `tools`, `skills` | Tool definitions and reusable instructions |
| Scheduling | `schedules`, `schedule_runs` | Cron jobs and execution history |
| Browser | `browser_profiles`, `browser_sessions`, `browser_proxies` | Browser automation infrastructure |
| Channels | `input_channels`, `channel_connections`, `integrations` | Third-party messaging integrations |
| Vault | `vault_connections`, `vault_audit_logs` | Credential management |
| Credits | `credits`, `credit_logs`, `credit_ledger` | Billing and usage tracking |
| Files | `bucket_files` | S3/MinIO file references |
| LLM | `llm_models` | Available model configurations |
| Content | `blogs`, `contact_submissions` | Public site content |

**Migration system:** Custom migration runner in `backend/src/db/migrate.ts` that:
- Tracks applied migrations in a `_migrations` table
- Handles idempotent re-runs
- Runs SQL files from `backend/src/db/migrations/`

### Redis

**Image:** `redis:7-alpine`

Used for:
- **BullMQ job queue** -- Schedules and processes background agent runs
- **Task state management** -- Worker concurrency control

### MinIO (S3-compatible Storage)

**Image:** `minio/minio:latest`

Provides S3-compatible object storage for:
- Chat file uploads
- Agent-generated files
- API-uploaded files
- Knowledge base source documents

**Configuration:**
- API endpoint: port 9000
- Web console: port 9001
- Default credentials: `minioadmin` / `minioadmin`
- Default bucket: `pushable-bucket`

The backend auto-creates the bucket on first use via the `@aws-sdk/client-s3` SDK with `forcePathStyle: true` for MinIO compatibility.

---

## Communication Patterns

### 1. REST API (Frontend <-> Backend)

All frontend-to-backend communication uses REST APIs via Axios:

```
Frontend (Axios client)
  → Authorization: Bearer <JWT token>
  → x-workspace-id: <workspace UUID>
  → Backend (Fastify route handlers)
```

Every protected request includes:
- `Authorization` header with JWT token
- `x-workspace-id` header for workspace scoping

### 2. WebSocket (Real-time Chat)

Chat uses a direct WebSocket connection for streaming responses:

```
Frontend (useChatWs hook)
  ↔ WebSocket
  ↔ Backend (chat route SSE/WS handler)
    → LangGraph agent execution
    → Streams tokens, tool calls, and debug info
```

### 3. WebSocket (Browser Automation)

Two browser modes with different communication paths:

**Cloud browser mode:**
```
Backend → HTTP → Browser Service (Python)
Browser Service → WebSocket → Frontend (live preview)
```

**Extension browser mode:**
```
Backend → WebSocket → Extension Bridge → WebSocket → Chrome Extension
Chrome Extension → WebSocket → Extension Bridge → WebSocket → Backend
```

### 4. Webhook (External Platforms)

Slack and Telegram send events to the backend:

```
Slack/Telegram → POST /webhooks/slack/events or /webhooks/telegram/:connectionId → Backend
Backend → Channel Manager → Agent Graph Execution → Response back to channel
```

### 5. Background Jobs (Scheduled Runs)

```
Scheduler → BullMQ Queue (Redis) → Worker → Agent Graph Execution
                                           → Credit deduction
                                           → Result logging
```

---

## External Service Dependencies

| Service | Purpose | Required? |
|---------|---------|-----------|
| **OpenRouter** | LLM gateway (Claude, GPT, Gemini models) | Yes |
| **Composio** | Third-party tool integrations (100+ toolkits) | No |
| **Capsolver** | CAPTCHA solving for browser automation | No |
| **Bitwarden** | Password vault credential management | No |
| **Slack API** | Slack bot channel integration | No |
| **Telegram API** | Telegram bot channel integration | No |
| **SMTP Server** | Email sending (contact form confirmations) | No |

---

## Data Flow: Agent Chat Execution

This is the core flow when a user sends a message to an agent:

```
1. User sends message via WebSocket
2. Backend creates/updates session and message records
3. Backend builds system prompt:
   - Agent's custom system prompt
   - Assigned knowledge bases (RAG context)
   - Assigned skills (instructions)
   - Available tools list
   - Channel integration context
4. Backend invokes LangGraph agent graph
5. LangGraph calls LLM via OpenRouter gateway
6. If LLM requests tool use:
   a. Check if tool requires approval
   b. If approval needed → interrupt, send approval card to user
   c. If approved or no approval needed → execute tool
   d. Return tool result to LLM
   e. Repeat (max 25 tool iterations)
7. If message count > 30 → auto-summarize older messages
8. Stream response tokens to frontend via WebSocket
9. Deduct credits from workspace balance
10. Save final message and run record to database
```

---

## Docker Volumes

| Volume | Service | Purpose |
|--------|---------|---------|
| `pgdata` | PostgreSQL | Database files |
| `redisdata` | Redis | Queue persistence |
| `minio-data` | MinIO | File storage |
| `bw-data` | Backend | Bitwarden session data |
| `browser_profiles` | Browser Service | Persistent browser profiles (prod only) |
| `browser_extensions` | Browser Service | Browser extensions (prod only) |

---

## Network Architecture

All services run on the default Docker Compose network and communicate via service names:

| From | To | Address |
|------|----|---------|
| Backend | PostgreSQL | `postgres:5432` |
| Backend | Redis | `redis:6379` |
| Backend | MinIO | `minio:9000` |
| Backend | Browser Service | `browser-service:8080` |
| Backend | Extension Bridge | `extension-bridge:3001` |
| Frontend | Backend | Via `NEXT_PUBLIC_API_URL` (external or `backend:4000`) |
| Admin Panel | PostgreSQL | Direct connection via `DATABASE_URL` |
| Admin Panel | Docker | `/var/run/docker.sock` mount |
| Public Frontend | Backend | `backend:4000` (internal) |
| Extension Bridge | Backend | `backend:4000` (internal) |

---

## Next Steps

- [Authentication](./03-authentication.md) -- How the auth system works
- [Agent System](./04-agent-system.md) -- Creating and running AI agents
