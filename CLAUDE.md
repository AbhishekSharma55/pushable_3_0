# Project Rules

## Documentation Maintenance

Platform docs live in `docs/platform/` (17 files). When you make code changes, check if the relevant doc needs updating:

- New/removed API endpoint → update `15-api-reference.md`
- Schema change (new table, column, enum) → update `16-database-schema.md`
- New env variable → update `17-deployment.md` and `01-getting-started.md`
- Auth flow change → update `03-authentication.md`
- Agent config change (new permission, field) → update `04-agent-system.md`
- Chat/streaming change → update `05-chat-conversations.md`
- New/modified tool → update `06-agent-tools.md`
- Browser automation change → update `07-browser-automation.md`
- KB/embedding change → update `08-knowledge-base.md`
- Integration change (Composio, Slack, Telegram, vault) → update `09-integrations.md`
- Schedule system change → update `10-scheduling.md`
- Credit/billing change → update `11-credits-billing.md`
- File storage change → update `12-file-management.md`
- Admin panel change → update `13-admin-panel.md`
- Public site change → update `14-public-website.md`
- Docker/service change → update `02-architecture-overview.md` and `17-deployment.md`

Only update docs when the change is meaningful (new feature, removed feature, changed behavior). Don't touch docs for refactors, bug fixes, or internal changes that don't affect documented behavior.

## Tech Stack

- **Backend:** Fastify 5, TypeScript, LangGraph JS, Drizzle ORM, BullMQ
- **Frontend:** Next.js 16, React 19, shadcn/ui, Tailwind CSS 4
- **Database:** PostgreSQL 16 + pgvector, Redis 7
- **Storage:** MinIO (dev) / S3 (prod)
- **LLM:** OpenRouter gateway (do NOT use OpenAI API directly — route through OpenRouter)
- **Orchestration:** Docker Compose

## Code Patterns

- Backend follows Route → Service → Repository layering
- All DB queries scoped by `workspaceId` (multi-tenant)
- Auth: JWT via `@fastify/jwt`, verified with `request.jwtVerify()` hook
- Validation: Zod schemas on all route inputs
- Agent graph: LangGraph StateGraph in `backend/src/graphs/agent.graph.ts`
- Tools: `DynamicStructuredTool` from `@langchain/core/tools`
