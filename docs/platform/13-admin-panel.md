# Admin Panel

The admin panel is a separate Next.js application for system administration. It provides user management, real-time monitoring, tool configuration, LLM model management, and Docker container oversight.

---

## Overview

| Aspect | Details |
|--------|---------|
| **URL** | `http://localhost:3002` |
| **Framework** | Next.js 16.2.0, React 19.2.4 |
| **Auth** | Separate JWT system (jose library, httpOnly cookies) |
| **Database** | Direct PostgreSQL connection (pg driver, raw SQL) |
| **Docker** | Mounts `/var/run/docker.sock` for container monitoring |

The admin panel is **completely separate** from the main frontend. It has its own authentication, its own database connection (direct, not via the backend API), and its own UI components.

---

## Authentication

### Credentials

Currently uses hardcoded credentials (should be migrated to database/env):
- **Email:** `admin@example.com`
- **Password:** `admin123`

### Token System

| Setting | Value |
|---------|-------|
| **Library** | jose (JWT) |
| **Algorithm** | HS256 |
| **Secret** | `AUTH_SECRET` env var (fallback: `pushable-admin-secret-key-change-in-prod`) |
| **Token expiry** | 24 hours |
| **Storage** | httpOnly cookie named `admin-session` |
| **Secure flag** | Controlled by `ADMIN_COOKIE_SECURE` env var |

### Middleware

All routes except `/login` are protected by Next.js middleware that:
1. Reads the `admin-session` cookie
2. Verifies the JWT token
3. Redirects to `/login` if invalid or missing
4. Deletes invalid cookies

---

## Pages

| Route | Status | Description |
|-------|--------|-------------|
| `/` | Redirect | Redirects to `/users` |
| `/login` | Live | Admin login form |
| `/users` | Live | User management with CRUD |
| `/monitoring` | Live | Platform analytics and resource monitoring |
| `/monitoring/logs` | Live | Docker container log viewer |
| `/tools` | Live | Global and workspace tool management |
| `/settings` | Live | LLM models, browser config, environment |
| `/dashboard` | Stub | Coming soon |
| `/plans` | Stub | Coming soon |

---

## User Management

### Features

- **Search** -- Filter users by name or email
- **Sort** -- By name, email, workspace, role, credits, join date, status (9 sort keys)
- **Filter** -- By status (Active/Blocked) and plan tier
- **Pagination** -- Configurable page size (default 10)
- **Export** -- Download user data as CSV

### User Actions

| Action | Description |
|--------|-------------|
| **View details** | Side drawer with full user info, workspace, credit breakdown |
| **Edit** | Update name, email, role |
| **Block/Unblock** | Sets `blocked_at` timestamp on user record |
| **Reset password** | Set new password (min 8 chars, bcryptjs 12 rounds) |
| **Delete** | Cascading delete of all workspace data (transaction) |

### Cascading Delete

Deleting a user deletes everything in order:
1. `credit_ledger`, `credit_logs`, `credits`
2. `schedule_runs`, `schedules`
3. `kb_chunks`, `kb_documents`, `knowledge_bases`
4. `messages`, `runs`, `sessions`
5. `agent_permissions`, `agent_integrations`, `agent_memories`, `agents`
6. `input_channels`, `channel_connections`
7. `tools`, `skills`, `integrations`
8. `browser_sessions`, `browser_profiles`, `browser_proxies`
9. `bucket_files`, `vault_audit_logs`, `vault_connections`
10. `workspace_members`, `workspaces`
11. `users`

### User Data Structure

```typescript
interface AdminUser {
  id: string;
  name: string;
  email: string;
  created_at: string;
  blocked_at: string | null;
  role: string;             // owner, admin, member
  workspace_name: string;
  workspace_id: string;
  credits_balance: number;
  total_credits_consumed: number;
  plan_credits: number;
  topup_credits: number;
}
```

---

## Monitoring

The monitoring page has 7 tabs providing comprehensive platform oversight.

### Tab 1: Server

Real-time system and Docker container statistics fetched from `/api/server-stats`.

**System info:**
- Hostname, platform, architecture
- CPU count and model
- Memory: total, free, used, usage %
- System uptime (formatted)
- Load average

**Container stats** (via Docker socket):
- Container ID, name, status, image
- CPU usage %
- Memory: usage, limit, usage %
- Network I/O (rx/tx bytes)
- Block I/O (read/write bytes)
- Process count (PIDs)
- Port mappings

### Tab 2: Overview

Platform-wide aggregate statistics:

| Metric | Source |
|--------|--------|
| Total users, workspaces, agents | Count queries |
| Total sessions, messages, runs | Count queries |
| Total credits consumed/balance | Sum queries |
| Total KB documents, schedules | Count queries |
| Active schedules, integrations | Filtered counts |
| Model usage | Grouped by model (calls, tokens, credits) |
| Credits by activity type | Grouped by ledger type |

### Tab 3: Workspaces

Expandable workspace cards showing per-workspace resources:

- Owner name and email
- Credit balance (plan + topup, consumed, overage settings)
- Agent, session, message, member counts
- KB, schedule, tool, integration counts

### Tab 4: API Calls

Last 50 credit deduction logs:
- Workspace, agent, model, tokens used, credits deducted, timestamp

### Tab 5: Credit Ledger

Last 50 credit transactions:
- Workspace, type, amount, balance after, timestamp

### Tab 6: Runs

Last 50 agent execution runs:
- Workspace, session title, status (color-coded), error, timestamp

### Tab 7: Schedule Runs

Last 50 scheduled job executions:
- Schedule name, workspace, status, credits used, duration, timestamps

### Container Logs

The `/monitoring/logs` page provides a Docker log viewer:

- **Container selector** -- Pick any running container
- **Tail lines** -- 100, 200, 500, 1000, or 2000 lines
- **Color coding** -- Red for errors, amber for warnings
- **Timestamps** -- Parsed Docker timestamps
- **Line numbers** -- Numbered log lines
- **Auto-scroll** -- Toggle auto-scroll to bottom
- **Download** -- Save logs as `.txt` file
- **Refresh** -- Re-fetch logs

---

## Tool Management

### Features

- **View modes** -- Grid or table layout
- **Filters** -- By type (MCP/Function), scope (Global/Workspace), search
- **Metrics** -- Global count, workspace count, MCP count, function count

### Tool Actions

| Action | Description |
|--------|-------------|
| **Create** | New tool with name, description, type, JSON config, scope, workspace |
| **Edit** | Update any tool property |
| **Delete** | Remove tool (cascades to agent_permissions) |
| **Copy config** | Copy tool's JSON config to clipboard |

### Tool Form Fields

```typescript
{
  name: string;
  description: string;
  type: "mcp" | "function";
  config: Record<string, unknown>;  // JSON editor
  is_global: boolean;
  workspace_id: string | null;      // null for global
}
```

---

## Settings / Configuration

The settings page has 3 tabs.

### Tab 1: Browser Settings

- **Browser agent model** -- Dropdown picker with active models grouped by provider
- **Custom system prompt** -- Textarea for browser agent instructions
- **Browser proxies** -- Add/delete/toggle proxies with full config (label, host, port, username, protocol, country, city)
- **Browser profiles** -- Read-only list (name, workspace, agent, OS, status)
- **Browser sessions** -- Read-only list of last 50 (workspace, profile, agent, status, dates)
- **Environment config** -- Gateway type, service URLs, API key status indicators (green/red)

### Tab 2: LLM Models

Full CRUD for the `llm_models` table:

| Field | Type | Description |
|-------|------|-------------|
| `model_id` | string | Provider model ID (e.g., `anthropic/claude-sonnet-4`) |
| `display_name` | string | Human-readable name |
| `provider` | string | openai, anthropic, google, deepseek, meta |
| `description` | string | Model description |
| `multiplier` | number | Credit cost multiplier |
| `context_window` | number | Max tokens |
| `is_active` | boolean | Available for use |
| `minimum_plan` | string | Required plan tier |
| `is_featured` | boolean | Highlighted in picker |
| `sort_order` | number | Display ordering |

Actions: Create, Edit, Delete, Toggle active status

### Tab 3: Agent Defaults

Read-only summary statistics:
- Total agents across all workspaces
- Count with system-level access enabled
- Count with approval required enabled
- Count with KB management enabled
- Top 10 models in use with counts

---

## API Routes (Admin Panel)

The admin panel has 2 internal API routes for Docker access:

### GET `/api/server-stats`

Returns system info and Docker container statistics.

**Implementation:** Connects to Docker socket at `/var/run/docker.sock`, fetches container list and stats, combines with Node.js `os` module system info.

### GET `/api/container-logs?id=<containerId>&tail=<lines>`

Returns container logs.

**Implementation:** Fetches logs from Docker API, strips 8-byte Docker stream headers, returns plain text. Default: 200 lines.

---

## Database Access

The admin panel connects directly to PostgreSQL (not through the backend API):

```typescript
import { Pool } from "pg";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});
```

All data operations use raw SQL queries via server actions. Tables accessed include all 33+ tables in the schema.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://postgres:...@postgres:5432/pushable_ai` | Direct DB connection |
| `AUTH_SECRET` | `pushable-admin-secret-key-change-in-prod` | JWT signing secret |
| `ADMIN_COOKIE_SECURE` | `true` (prod) | Secure cookie flag |
| `NEXT_PUBLIC_API_URL` | `https://api.pushable.ai` | Backend API URL (for display) |

---

## Next Steps

- [Public Website](./14-public-website.md) -- Marketing site and blog system
- [API Reference](./15-api-reference.md) -- Complete endpoint listing
