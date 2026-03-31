# Pushable AI — Platform Documentation

Complete technical documentation for the Pushable AI platform.

---

## Table of Contents

### Getting Started
1. [Getting Started](./01-getting-started.md) — Setup, environment variables, Docker Compose, first run

### Architecture
2. [Architecture Overview](./02-architecture-overview.md) — Service diagram, data flow, tech stack
3. [Authentication](./03-authentication.md) — Login/register flow, JWT, roles, workspace isolation

### Core Features
4. [Agent System](./04-agent-system.md) — Creating agents, model selection, permissions, LangGraph engine
5. [Chat & Conversations](./05-chat-conversations.md) — Real-time streaming, SSE, HITL approval, file attachments
6. [Agent Tools](./06-agent-tools.md) — 8 built-in tool categories, MCP servers, Composio, agent delegation

### Platform Capabilities
7. [Browser Automation](./07-browser-automation.md) — Cloud and extension browser modes, proxies, CAPTCHA
8. [Knowledge Base](./08-knowledge-base.md) — Document upload, chunking, vector embeddings, RAG search
9. [Integrations](./09-integrations.md) — Composio, Slack, Telegram, Bitwarden vault, MCP servers
10. [Scheduling](./10-scheduling.md) — Cron, natural language, presets, business hours, BullMQ
11. [Credits & Billing](./11-credits-billing.md) — Credit system, cost calculation, ledger, plan tiers
12. [File Management](./12-file-management.md) — S3/MinIO storage, upload, preview, quotas

### Applications
13. [Admin Panel](./13-admin-panel.md) — User management, monitoring, Docker logs, settings
14. [Public Website](./14-public-website.md) — Marketing site, blog, pricing, contact form

### Reference
15. [API Reference](./15-api-reference.md) — Complete listing of 150+ HTTP endpoints
16. [Database Schema](./16-database-schema.md) — All 33+ tables with columns and relationships
17. [Deployment](./17-deployment.md) — Docker setup, dev vs prod, environment configuration
