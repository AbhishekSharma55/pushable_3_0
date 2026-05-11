# Repo Overview

A one-page map of the Pushable AI codebase for new contributors and reviewers.
For a deeper dive into any subsystem, see [`docs/platform/`](./docs/platform/README.md).

---

## What this project does

Pushable AI is a **multi-tenant platform for building and running AI agents**.
A workspace owner can:

- Create agents with a custom system prompt, model, and per-tool permissions.
- Chat with agents over real-time streaming (SSE), including file attachments and human-in-the-loop approvals.
- Give agents access to a knowledge base (RAG over pgvector), Composio's 1,200+ third-party toolkits, a Python sandbox, file storage, a Bitwarden vault, persistent memory, and a real or cloud browser.
- Schedule agents on cron, natural-language, or preset triggers, with credit-based billing per run.
- Plug agents into Slack and Telegram as bots.

It is a real product — not a demo. The system has been driven by a real workload and the design choices reflect that.

---

## Tech stack

| Layer | Tech |
|-------|------|
| Backend | Fastify 5, TypeScript, LangGraph JS (state-machine agent engine), Drizzle ORM, BullMQ |
| Frontend (×3) | Next.js 16, React 19, shadcn/ui, Tailwind CSS 4 |
| Data | PostgreSQL 16 + pgvector, Redis 7 |
| Storage | MinIO (dev) / S3 (prod) |
| LLM gateway | OpenRouter (Claude, GPT, Gemini, DeepSeek, Llama) |
| Browser automation | Camoufox (anti-detect Firefox via Playwright) + Chrome extension bridge |
| Orchestration | Docker Compose (8 services) |

---

## Directory map

```
pushable_3_0/
├── backend/             Fastify API + LangGraph agent engine + BullMQ workers
│   └── src/
│       ├── routes/        29 HTTP route files (REST)
│       ├── services/      Business logic
│       ├── repositories/  Data access (Drizzle)
│       ├── graphs/        LangGraph agent state graph
│       ├── tools/         Built-in agent tools (browser, python, kb, vault, …)
│       ├── channels/      Slack / Telegram bot bindings
│       ├── processors/    BullMQ job processors
│       ├── lib/           gateway.ts, credit-engine.ts, scheduler.ts, queue.ts
│       └── db/            Drizzle schema + migrations
│
├── frontend/            Main dashboard (Next.js, port 3000)
├── admin-panel/         Internal admin UI (Next.js, port 3002)
├── public-frontend/     Marketing site (Next.js, port 3001)
│
├── browser-service/     Python/FastAPI service running Camoufox + Playwright
├── extension-bridge/    Node.js WebSocket relay between backend and Chrome extension
├── extension-v4/        Chrome extension (user's real browser automation)
├── cdp-analyzer/        Python service for Chrome DevTools Protocol DOM analysis
│
├── camoufox-main/       Vendored upstream Camoufox build tree (only pythonlib/ is used at runtime — see KNOWN_ISSUES.md)
│
├── docs/platform/       17 deep-dive technical docs (architecture, every subsystem)
├── REPO_OVERVIEW.md     This file
├── HIGHLIGHTS.md        Engineering decisions worth talking about
├── KNOWN_ISSUES.md      Tracked rough edges
├── scripts/             Dev helper scripts (Claude proxy, MCP test, Chrome launcher)
│
├── docker-compose.dev.yml
├── docker-compose.prod.yml
├── dev.sh               Local development bootstrap
├── deploy.sh            Production deployment
└── env.example          Environment variable template
```

---

## How it runs (locally)

Prereqs: Docker 24+, Docker Compose v2, an OpenRouter API key.

```bash
cp env.example .env
# Edit .env and fill in POSTGRES_PASSWORD, JWT_SECRET, OPENROUTER_KEY at minimum.

chmod +x dev.sh
./dev.sh
```

Then open:

| URL | Service |
|-----|---------|
| http://localhost:3000 | Dashboard (register here) |
| http://localhost:3001 | Public marketing site |
| http://localhost:3002 | Admin panel |
| http://localhost:4000 | Backend API |
| http://localhost:9001 | MinIO console |

Migrations run automatically when the backend boots.

---

## How a request flows

Reading a chat message end-to-end:

```
Browser
  │  POST /chat/:conversationId/messages   (SSE)
  ▼
Frontend (Next.js)
  │  fetch() with Bearer JWT
  ▼
Backend route (routes/chat.ts)
  │  Zod-validates input, jwtVerify(), workspace-scopes the conversation
  ▼
Service layer (services/chat.service.ts)
  │  Persists user message, opens an SSE stream
  ▼
LangGraph agent (graphs/agent.graph.ts)
  │  Node by node: load context → call LLM via gateway →
  │  may call tools (browser / python / kb / composio / …) →
  │  may pause for HITL approval → produce assistant message
  ▼
Repository (repositories/*.ts via Drizzle)
  │  workspaceId-scoped DB writes
  ▼
PostgreSQL + Redis (BullMQ for any async follow-ups)
```

Tool calls that need a real browser are dispatched to either `browser-service`
(cloud Camoufox) or `extension-bridge` → user's Chrome extension.

---

## Known issues / TODO

See [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md).

---

## Where to go next

- New to the platform → [`docs/platform/01-getting-started.md`](./docs/platform/01-getting-started.md)
- Curious about the agent engine → [`docs/platform/04-agent-system.md`](./docs/platform/04-agent-system.md)
- Want the API surface → [`docs/platform/15-api-reference.md`](./docs/platform/15-api-reference.md)
- Want the DB shape → [`docs/platform/16-database-schema.md`](./docs/platform/16-database-schema.md)
- Interview talking points → [`HIGHLIGHTS.md`](./HIGHLIGHTS.md)
