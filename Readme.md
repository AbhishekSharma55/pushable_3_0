# Pushable AI

> Deploy, manage, and orchestrate AI agents as employees.

## Architecture

apps/
  web/        → Next.js 15 + shadcn/ui (Frontend)
  server/     → Fastify + LangGraph JS (Agent Runner)
packages/
  db/         → Drizzle ORM schema + migrations
  types/      → Shared TypeScript types

## Tech Stack

| Layer       | Tool                     |
|-------------|--------------------------|
| Frontend    | Next.js 15, shadcn/ui    |
| Auth        | Custom JWT + bcrypt      |
| Agent Core  | LangGraph JS             |
| API Server  | Fastify                  |
| Database    | Postgres + pgvector      |
| ORM         | Drizzle ORM              |
| Queue       | BullMQ + Upstash Redis   |
| Telegram    | Grammy.js                |
| Streaming   | Vercel AI SDK            |
| Deploy      | Vercel + Contabo         |

## Getting Started

# Install deps
pnpm install

# Copy env files
cp apps/web/.env.example apps/web/.env.local
cp apps/server/.env.example apps/server/.env

# Run migrations
pnpm db:migrate

# Start dev
pnpm dev

## Environment Variables

See `apps/web/.env.example` and `apps/server/.env.example`

## Key Conventions

- Every DB query scoped by `workspaceId`
- Route → Service → Repository pattern
- No business logic in route handlers
- All agent runs proxied through Next.js passthrough route

## Modules

| Module            | Status |
|-------------------|--------|
| Auth + Users      | 🔲     |
| Workspaces        | 🔲     |
| Agents            | 🔲     |
| Sessions + Chat   | 🔲     |
| Tools / MCP       | 🔲     |
| Agent Permissions | 🔲     |
| Knowledge Base    | 🔲     |
| Skills            | 🔲     |
| Tasks             | 🔲     |
| Workflows         | 🔲     |
| Schedules         | 🔲     |
| Credits           | 🔲     |
| Input Channels    | 🔲     |
