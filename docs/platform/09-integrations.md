# Integrations

Pushable AI supports multiple integration types: **Composio** (1200+ third-party toolkits), **Slack** and **Telegram** channels, **Bitwarden** vault, and custom **MCP server** tools.

---

## Composio Integrations

Composio provides pre-built integrations with third-party services (Google Sheets, Gmail, GitHub, Slack, Jira, etc.). Each integration gives agents a set of tools to interact with the connected service.

### How It Works

```
1. Browse toolkits        → GET /api/integrations/toolkits
2. Connect integration    → POST /api/integrations/connect
3. OAuth redirect         → User authorizes in browser
4. Callback               → POST /api/integrations/callback
5. Integration active     → Agent can use the integration's tools
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/integrations/toolkits` | Browse available Composio toolkits (paginated, searchable) |
| `GET` | `/api/integrations` | List workspace integrations |
| `POST` | `/api/integrations/connect` | Start OAuth connection flow |
| `POST` | `/api/integrations/callback` | Handle OAuth callback |
| `GET` | `/api/integrations/:id` | Get integration details |
| `DELETE` | `/api/integrations/:id` | Disconnect an integration |
| `PUT` | `/api/integrations/:id` | Update connection label/description |
| `PUT` | `/api/integrations/:id/tool-permissions` | Set tool allowlist/blocklist |
| `GET` | `/api/integrations/:id/tools` | List available tools for an integration |
| `POST` | `/api/integrations/:id/learn-tools` | Extract tool information for the integration |

### Connect an Integration

```json
POST /api/integrations/connect
{
  "toolkitSlug": "google-sheets",
  "name": "Google Sheets",
  "connectionLabel": "My Google Sheets",
  "connectionDescription": "Connected to team@company.com",
  "logo": "https://..."
}
```

This returns a redirect URL where the user completes OAuth authorization. After authorization, the callback updates the integration status to `active`.

### Tool Permissions

Each integration's tools can be filtered:

```json
PUT /api/integrations/:id/tool-permissions
{
  "mode": "allowlist",
  "tools": ["GOOGLESHEETS_READ_SHEET", "GOOGLESHEETS_WRITE_CELL"]
}
```

Modes:
- `"allowlist"` -- Only listed tools are available
- `"blocklist"` -- All tools except listed ones are available

### Assigning to Agents

After connecting, assign the integration to an agent via resource permissions:

```json
POST /api/agents/:agentId/permissions
{
  "permissions": [
    { "resourceType": "tool", "resourceId": "integration-uuid", "allowed": true }
  ]
}
```

### Database Schema

```sql
integrations
  ├── id                    UUID
  ├── workspaceId           UUID (FK → workspaces, cascade delete)
  ├── name                  TEXT (app display name)
  ├── toolkitSlug           TEXT (Composio toolkit ID)
  ├── connectedAccountId    TEXT (Composio connection ID)
  ├── connectionLabel       TEXT (user-defined label)
  ├── connectionDescription TEXT (optional)
  ├── logo                  TEXT (icon URL)
  ├── status                ENUM: active, inactive, pending, failed
  ├── config                JSONB (tool permissions, etc.)
  ├── createdAt             TIMESTAMP
  └── updatedAt             TIMESTAMP
```

### How Agents Use Composio

During graph compilation:
1. Assigned integrations are loaded from the database
2. For each active integration, tools are fetched from the Composio API
3. Tools are filtered by the permission mode (allowlist/blocklist)
4. A `COMPOSIO_MULTI_EXECUTE_TOOL` is created that can call any of the integration's actions
5. The agent calls this tool with the specific `tool_slug` for each action

---

## Slack Integration

Agents can receive messages from and respond to Slack channels.

### Setup Flow

1. Create a Slack App in the Slack API dashboard
2. Configure event subscriptions and interactive messages
3. Connect the Slack app in Pushable via the Channels page
4. Assign the channel to an agent

### Webhook Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/webhooks/slack/events` | Receive Slack events (messages, mentions) |
| `POST` | `/webhooks/slack/interactive` | Handle interactive components (buttons, menus) |

These endpoints are **public** (no JWT auth) -- Slack sends events directly.

### Event Handling

1. Slack sends an event to `/webhooks/slack/events`
2. If it's a URL verification challenge, the backend responds with the challenge token
3. For message events, the backend:
   - Matches the team ID to a workspace's channel connection
   - Routes the message to the assigned agent
   - Executes the agent graph
   - Sends the response back to the Slack channel

### Channel Connection Schema

```sql
channel_connections
  ├── id               UUID
  ├── workspaceId      UUID (FK → workspaces)
  ├── channelType      ENUM: telegram, slack
  ├── name             TEXT (display name)
  ├── credentials      JSONB (bot token, signing secret, etc.)
  ├── config           JSONB (additional settings)
  ├── status           ENUM: active, inactive, error
  ├── createdAt        TIMESTAMP
  └── updatedAt        TIMESTAMP
```

### Channel API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/channels` | List channel connections |
| `POST` | `/api/channels` | Create a channel connection |
| `GET` | `/api/channels/:id` | Get channel details |
| `PUT` | `/api/channels/:id` | Update channel configuration |
| `DELETE` | `/api/channels/:id` | Delete a channel connection |
| `POST` | `/api/channels/:id/test` | Test a channel connection |

---

## Telegram Integration

Pushable uses a **shared platform Telegram bot** that serves all workspaces. Each user links their Telegram account to their workspace, and messages are routed to their CEO agent.

### Setup (Admin)

1. Create a Telegram bot via @BotFather and get the bot token
2. Set `TELEGRAM_BOT_TOKEN` in your environment / Docker Compose
3. Restart the backend — the platform bot starts automatically

### User Flow

1. Go to **Channels** page in the dashboard
2. Click **Connect Telegram**
3. A 6-character verification code is generated (valid for 10 minutes)
4. Open Telegram, find the bot (e.g., `@PushableAIBot`), and send the code
5. The bot confirms the link — the user can now chat with their CEO agent

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/telegram/status` | Check if platform bot is available, list linked accounts |
| `POST` | `/api/telegram/link` | Generate a verification code for linking |
| `GET` | `/api/telegram/link-status` | Poll to check if verification completed |
| `DELETE` | `/api/telegram/links/:id` | Unlink a Telegram account |

### How It Works

1. A single Grammy.js bot instance runs using `TELEGRAM_BOT_TOKEN`
2. When a user sends a message, the bot looks up `telegram_user_links` by `from.id`
3. If linked, the message is routed to the workspace's CEO agent via the agent graph
4. The CEO agent responds, and the reply is sent back to the user in Telegram
5. One Telegram account can be linked to one workspace (UNIQUE constraint)

### Human-in-the-Loop via Telegram

When the CEO agent needs approval (HITL), an inline keyboard with Approve/Reject buttons is sent. The user taps a button, and the agent resumes with the decision.

### Implementation

- **Framework:** Grammy.js (v1.41.1) — Telegram Bot Framework
- **Platform bot:** `backend/src/channels/platform-telegram.ts` (shared singleton)
- **Per-workspace bot (legacy):** `backend/src/channels/telegram.channel.ts`
- **Verification:** `backend/src/lib/telegram-verification.ts` (in-memory codes with TTL)
- **DB table:** `telegram_user_links` maps Telegram user IDs to workspaces

---

## Bitwarden Vault Integration

Agents can access stored credentials from a connected Bitwarden vault to log into websites during browser automation.

### Setup

1. Go to the Secrets page in the dashboard
2. Connect your Bitwarden account
3. The connection is encrypted and stored

### How It Works

1. The workspace connects to Bitwarden (credentials encrypted with AES-256-GCM)
2. When an agent needs login credentials, it calls `vault_get_credential`
3. The backend decrypts the vault connection
4. Searches the Bitwarden vault for the requested item
5. Returns username, password, and URI to the agent
6. The agent fills login forms during browser automation

### Security

- **Encryption:** Vault tokens encrypted with AES-256-GCM using `VAULT_ENCRYPTION_KEY`
- **KDF support:** Password derivation for vault access
- **Workspace isolation:** Each workspace has its own vault data directory
- **Audit logging:** All vault operations are logged

### Database Schema

```sql
vault_connections
  ├── id               UUID
  ├── workspaceId      UUID (FK → workspaces)
  ├── provider         ENUM: bitwarden
  ├── encryptedToken   TEXT (AES-256-GCM encrypted)
  ├── encryptedVaultKey TEXT
  ├── kdfType          INTEGER
  ├── kdfIterations    INTEGER
  ├── status           ENUM: active, inactive, failed
  ├── lastSyncAt       TIMESTAMP
  ├── createdAt        TIMESTAMP
  └── updatedAt        TIMESTAMP

vault_audit_logs
  ├── id               UUID
  ├── workspaceId      UUID (FK → workspaces)
  ├── connectionId     UUID (FK → vault_connections)
  ├── action           ENUM: connect, disconnect, credential_fetch,
  │                          token_refresh, test, error
  ├── metadata         JSONB
  ├── createdAt        TIMESTAMP
  └── updatedAt        TIMESTAMP
```

### Vault API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/vault` | Get vault connection status |
| `POST` | `/api/vault/connect` | Connect Bitwarden vault |
| `DELETE` | `/api/vault/disconnect` | Disconnect vault |
| `POST` | `/api/vault/test` | Test vault connection |

---

## MCP Server Tools

Model Context Protocol (MCP) servers expose custom tools that agents can use. See [Agent Tools](./06-agent-tools.md#mcp-server-tools) for details.

### Quick Reference

```json
POST /api/tools
{
  "name": "Custom API Server",
  "type": "mcp",
  "config": {
    "url": "http://my-mcp-server:3005/mcp",
    "transport": "sse"
  }
}
```

Assign to agents via resource permissions, and the tools are discovered and made available automatically during graph compilation.

---

## Channel Manager

The Channel Manager (`backend/src/channels/channel-manager.ts`) orchestrates all channel integrations:

- **Startup initialization:** On backend start, all active channel connections are loaded and initialized (bots started, webhooks registered)
- **Connection management:** Adding/removing connections dynamically starts/stops the corresponding bots
- **Message routing:** Incoming messages are matched to their connection and routed to the assigned agent
- **Error recovery:** Failed connections are retried and their status is updated

### Input Channels

Input channels link agents to specific channel connections:

```sql
input_channels
  ├── id               UUID
  ├── workspaceId      UUID (FK → workspaces)
  ├── agentId          UUID (FK → agents)
  ├── channelType      ENUM: telegram, slack
  ├── connectionId     UUID (FK → channel_connections)
  ├── config           JSONB
  ├── createdAt        TIMESTAMP
  └── updatedAt        TIMESTAMP
```

This many-to-many relationship allows:
- One agent to receive messages from multiple channels
- One channel to route to different agents (based on configuration)

---

## Integration Summary

| Integration | Protocol | Auth Method | Real-time? |
|-------------|----------|-------------|------------|
| **Composio** | REST API | API key + OAuth per service | No (on-demand) |
| **Slack** | Webhooks | Bot token + signing secret | Yes (events) |
| **Telegram** | Webhooks | Bot token | Yes (updates) |
| **Bitwarden** | CLI/API | Encrypted credentials | No (on-demand) |
| **MCP Servers** | SSE/WebSocket | Per-server config | Depends |

---

## Next Steps

- [Scheduling](./10-scheduling.md) -- Cron-based agent scheduling
- [Credits & Billing](./11-credits-billing.md) -- Credit system and usage tracking
