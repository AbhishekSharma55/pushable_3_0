# API Reference

Complete listing of all backend HTTP endpoints. The backend runs on port 4000 with all routes prefixed under `/api` (except webhooks and health check).

---

## Common Headers

All authenticated endpoints require:

| Header | Description |
|--------|-------------|
| `Authorization` | `Bearer <JWT token>` |
| `x-workspace-id` | UUID of the current workspace |
| `Content-Type` | `application/json` (unless multipart) |

---

## Health Check

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | No | Returns `{"status":"ok"}` |

---

## Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/register` | No | Create account (name, email, password) |
| `POST` | `/api/auth/login` | No | Login (email, password) |

---

## Workspaces

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/workspaces` | JWT | List user's workspaces |
| `POST` | `/api/workspaces` | JWT | Create workspace |
| `GET` | `/api/workspaces/:id` | JWT | Get workspace details |
| `GET` | `/api/workspaces/:id/extension-settings` | JWT | Get extension API key settings |
| `POST` | `/api/workspaces/:id/extension-settings/regenerate` | JWT | Regenerate extension API key |

---

## Agents

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/agents` | JWT + WS | List agents in workspace |
| `POST` | `/api/agents` | JWT + WS | Create agent |
| `GET` | `/api/agents/:id` | JWT + WS | Get agent details |
| `PUT` | `/api/agents/:id` | JWT + WS | Update agent config |
| `DELETE` | `/api/agents/:id` | JWT + WS | Delete agent |
| `PUT` | `/api/agents/:id/system-permissions` | JWT + WS | Update system permissions |
| `GET` | `/api/agents/:id/debug/context` | JWT + WS | Get memories and notebook |
| `GET` | `/api/agents/ceo` | JWT + WS | Get or create CEO agent |

---

## Permissions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/agents/:agentId/permissions` | JWT + WS | Get agent resource permissions |
| `POST` | `/api/agents/:agentId/permissions` | JWT + WS | Set agent resource permissions |

---

## Sessions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/agents/:agentId/sessions` | JWT + WS | List sessions for agent |
| `POST` | `/api/agents/:agentId/sessions` | JWT + WS | Create session |
| `DELETE` | `/api/agents/:agentId/sessions/:id` | JWT + WS | Delete session |
| `GET` | `/api/sessions` | JWT + WS | List all workspace sessions |
| `GET` | `/api/sessions/:id/messages` | JWT + WS | Get session messages |
| `GET` | `/api/sessions/:id/browser-session` | JWT + WS | Get active browser session |

---

## Chat

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/sessions/:sessionId/chat` | JWT + WS | Send message (JSON or multipart with files) |
| `GET` | `/api/runs/:runId/events` | JWT + WS | SSE stream of run events |
| `GET` | `/api/sessions/:sessionId/active-run` | JWT + WS | Get active run for session |
| `POST` | `/api/runs/:runId/approve` | JWT + WS | Approve/edit/reject tool calls (HITL) |
| `GET` | `/api/notifications/pending` | JWT + WS | Get pending approval notifications |

---

## Knowledge Base

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/kb` | JWT + WS | List knowledge bases |
| `POST` | `/api/kb` | JWT + WS | Create knowledge base |
| `GET` | `/api/kb/:id` | JWT + WS | Get KB details |
| `PUT` | `/api/kb/:id` | JWT + WS | Update KB |
| `DELETE` | `/api/kb/:id` | JWT + WS | Delete KB |
| `GET` | `/api/kb/:kbId/documents` | JWT + WS | List documents in KB |
| `POST` | `/api/kb/:kbId/documents/upload` | JWT + WS | Upload document (multipart) |
| `DELETE` | `/api/kb/:kbId/documents/:id` | JWT + WS | Delete document |
| `GET` | `/api/kb/:kbId/documents/:docId/chunks` | JWT + WS | List chunks for document |
| `GET` | `/api/kb/:kbId/chunks` | JWT + WS | List all chunks in KB |
| `PUT` | `/api/kb/chunks/:chunkId` | JWT + WS | Update chunk content |
| `DELETE` | `/api/kb/chunks/:chunkId` | JWT + WS | Delete chunk |
| `POST` | `/api/kb/:kbId/documents/:docId/chunks` | JWT + WS | Add manual chunk |

---

## Tools

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/tools` | JWT + WS | List tools |
| `POST` | `/api/tools` | JWT + WS | Create tool |
| `GET` | `/api/tools/:id` | JWT + WS | Get tool details |
| `PUT` | `/api/tools/:id` | JWT + WS | Update tool |
| `DELETE` | `/api/tools/:id` | JWT + WS | Delete tool |

---

## Skills

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/skills` | JWT + WS | List skills |
| `POST` | `/api/skills` | JWT + WS | Create skill |
| `GET` | `/api/skills/:id` | JWT + WS | Get skill details |
| `PUT` | `/api/skills/:id` | JWT + WS | Update skill |
| `DELETE` | `/api/skills/:id` | JWT + WS | Delete skill |

---

## Schedules

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/schedules/presets` | JWT + WS | Get schedule presets |
| `POST` | `/api/schedules/preview` | JWT + WS | Preview NL → cron conversion |
| `GET` | `/api/schedules` | JWT + WS | List schedules |
| `POST` | `/api/schedules` | JWT + WS | Create schedule |
| `GET` | `/api/schedules/:id` | JWT + WS | Get schedule details |
| `PUT` | `/api/schedules/:id` | JWT + WS | Update schedule |
| `DELETE` | `/api/schedules/:id` | JWT + WS | Delete schedule |
| `GET` | `/api/schedules/:id/runs` | JWT + WS | Get run history (paginated) |
| `GET` | `/api/schedules/:id/stats` | JWT + WS | Get aggregate statistics |

---

## Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List all projects |
| GET | `/api/projects/:id` | Get project with milestones, agents, KBs |
| POST | `/api/projects` | Create project |
| PUT | `/api/projects/:id` | Update project |
| DELETE | `/api/projects/:id` | Delete project |
| POST | `/api/projects/:id/agents` | Assign agent to project |
| DELETE | `/api/projects/:id/agents/:agentId` | Remove agent |
| POST | `/api/projects/:id/milestones` | Create milestone |
| PUT | `/api/projects/:id/milestones/:milestoneId` | Update milestone |
| DELETE | `/api/projects/:id/milestones/:milestoneId` | Delete milestone |
| POST | `/api/projects/:id/kb` | Link KB to project |
| DELETE | `/api/projects/:id/kb/:kbId` | Unlink KB |
| GET | `/api/projects/:id/reports` | Get run reports for project |

---

## Run Reports

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/run-reports` | List run reports (filterable) |
| GET | `/api/run-reports/:id` | Get single run report |

---

## Integrations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/integrations/toolkits` | JWT | Browse Composio toolkits |
| `GET` | `/api/integrations` | JWT + WS | List workspace integrations |
| `POST` | `/api/integrations/connect` | JWT + WS | Start OAuth connection |
| `POST` | `/api/integrations/callback` | JWT + WS | Handle OAuth callback |
| `GET` | `/api/integrations/:id/status` | JWT + WS | Poll connection status |
| `PUT` | `/api/integrations/:id` | JWT + WS | Update connection |
| `DELETE` | `/api/integrations/:id` | JWT + WS | Delete integration |
| `PUT` | `/api/integrations/:id/permissions` | JWT + WS | Set tool allowlist/blocklist |
| `GET` | `/api/integrations/toolkits/:slug/actions` | JWT + WS | List toolkit actions |
| `POST` | `/api/agents/:agentId/integrations/:integrationId` | JWT + WS | Assign integration to agent |
| `DELETE` | `/api/agents/:agentId/integrations/:integrationId` | JWT + WS | Remove integration from agent |
| `GET` | `/api/agents/:agentId/integrations` | JWT + WS | Get agent's integrations |
| `GET` | `/api/integrations/:id/learnings` | JWT + WS | Get tool learnings |
| `DELETE` | `/api/integrations/learnings?key=<key>` | JWT + WS | Delete tool learning |

---

## Browser

### Profiles

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/browser/profiles` | JWT + WS | List browser profiles |
| `POST` | `/api/browser/profiles` | JWT + WS | Create profile |
| `PUT` | `/api/browser/profiles/:id` | JWT + WS | Update profile |
| `DELETE` | `/api/browser/profiles/:id` | JWT + WS | Delete profile |

### Sessions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/browser/sessions/start` | JWT + WS | Start browser session |
| `DELETE` | `/api/browser/sessions/:id` | JWT + WS | End browser session |
| `GET` | `/api/browser/sessions` | JWT + WS | List browser sessions |

### Proxies

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/browser/proxies` | JWT + WS | List proxies |
| `POST` | `/api/browser/proxies` | JWT + WS | Create proxy |
| `POST` | `/api/browser/proxies/:id/test` | JWT + WS | Test proxy |
| `PUT` | `/api/browser/proxies/:id` | JWT + WS | Update proxy |
| `DELETE` | `/api/browser/proxies/:id` | JWT + WS | Delete proxy |

---

## Vault

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/vault/connect` | JWT + WS | Connect Bitwarden vault |
| `GET` | `/api/vault/status` | JWT + WS | Get vault connection status |
| `POST` | `/api/vault/test` | JWT + WS | Test vault connection |
| `DELETE` | `/api/vault/disconnect` | JWT + WS | Disconnect vault |
| `POST` | `/api/vault/get-credential` | JWT + WS | Retrieve credential |

---

## Channels

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/channels` | JWT + WS | List channel connections |
| `POST` | `/api/channels` | JWT + WS | Create channel connection |
| `POST` | `/api/channels/:id/test` | JWT + WS | Test channel |
| `PUT` | `/api/channels/:id` | JWT + WS | Update channel |
| `GET` | `/api/channels/:id/bot-info` | JWT + WS | Get Telegram bot info |
| `GET` | `/api/channels/:id/config` | JWT + WS | Get channel config |
| `DELETE` | `/api/channels/:id` | JWT + WS | Delete channel |

---

## File Storage (Bucket)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/bucket/files` | JWT + WS | List files (with filters) |
| `GET` | `/api/bucket/files/:id` | JWT + WS | Get file metadata |
| `POST` | `/api/bucket/files/upload` | JWT + WS | Upload files (multipart) |
| `GET` | `/api/bucket/files/:id/download` | JWT + WS | Download file |
| `DELETE` | `/api/bucket/files/:id` | JWT + WS | Delete file |
| `PUT` | `/api/bucket/files/:id` | JWT + WS | Rename or move file |
| `PUT` | `/api/bucket/files/:id/content` | JWT + WS | Update file content (text files only, body: `{ content: string }`) |
| `GET` | `/api/bucket/folders` | JWT + WS | List folders |
| `POST` | `/api/bucket/folders` | JWT + WS | Create folder |
| `GET` | `/api/bucket/usage` | JWT + WS | Get storage usage |

---

## Credits

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/credits/balance` | JWT + WS | Get credit balance |
| `GET` | `/api/credits/ledger` | JWT + WS | Get transaction history |
| `POST` | `/api/credits/dev-topup` | JWT + WS | Dev credit top-up |

---

## LLM Models

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/models` | JWT + WS | Get available models for plan |
| `GET` | `/api/models/all` | JWT + WS | Get all models with availability |
| `GET` | `/api/llm/models` | JWT | Get all OpenRouter models |
| `GET` | `/api/llm/providers` | JWT | Get models grouped by provider |
| `GET` | `/api/llm/models/search?q=<query>` | JWT | Search models |
| `GET` | `/api/llm/models/:modelId/capabilities` | JWT | Get model capabilities |

---

## Blogs (Public + Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/public/blogs` | No | Get published blogs |
| `GET` | `/api/public/blogs/:slug` | No | Get published blog by slug |
| `GET` | `/api/blogs` | JWT + WS | Get all workspace blogs |
| `POST` | `/api/blogs` | JWT + WS | Create blog post |
| `GET` | `/api/blogs/:id` | JWT + WS | Get blog post |
| `PUT` | `/api/blogs/:id` | JWT + WS | Update blog post |
| `DELETE` | `/api/blogs/:id` | JWT + WS | Delete blog post |

---

## Contact

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/public/contact` | No | Submit contact form |
| `GET` | `/api/contact-submissions` | JWT + WS | List submissions |
| `GET` | `/api/contact-submissions/:id` | JWT + WS | Get submission |
| `PATCH` | `/api/contact-submissions/:id/status` | JWT + WS | Update status |
| `DELETE` | `/api/contact-submissions/:id` | JWT + WS | Delete submission |

---

## Webhooks (External)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/webhooks/telegram/:connectionId` | No | Telegram bot updates |
| `POST` | `/webhooks/slack/events` | No | Slack event callbacks |
| `POST` | `/webhooks/slack/interactive` | No | Slack interactive events |

---

## Internal

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/internal/extension/validate-key?key=<key>` | No | Validate extension API key |

---

## Extension

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/extension/download` | No | Download browser extension ZIP |

---

## Error Response Format

All errors follow a consistent format:

```json
{
  "error": {
    "message": "Description of the error",
    "code": "ERROR_CODE"
  }
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Zod validation failed |
| `MISSING_WORKSPACE` | 400 | Missing x-workspace-id header |
| `UNAUTHORIZED` | 401 | Invalid or missing JWT token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Duplicate resource (e.g., email taken) |
| `RUN_IN_PROGRESS` | 409 | Concurrent run on session |
| `INSUFFICIENT_CREDITS` | 402 | Not enough credits |
| `INTERNAL_ERROR` | 500 | Unhandled server error |

---

**Total: 24 route files, 150+ HTTP endpoints**

---

## Next Steps

- [Database Schema](./16-database-schema.md) -- All 33 tables with relationships
- [Deployment](./17-deployment.md) -- Docker setup and production configuration
