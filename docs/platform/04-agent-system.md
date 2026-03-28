# Agent System

Agents are the core entity in Pushable AI. Each agent is a configurable AI employee that can chat with users, use tools, browse the web, access knowledge bases, and execute scheduled tasks.

---

## Overview

An agent combines:
- An **LLM model** (via OpenRouter) for reasoning
- A **system prompt** defining its personality and instructions
- **Tools** it can invoke (browser, Python, file storage, vault, MCP servers, Composio integrations)
- **Knowledge bases** for RAG (retrieval-augmented generation)
- **Skills** (reusable instruction sets)
- **Permissions** controlling what it can access and modify
- **Browser automation** capabilities (cloud or extension mode)
- **Channel connections** (Slack, Telegram) for messaging

---

## Agent Configuration

### Database Schema

```sql
agents
  ├── id                    UUID (primary key)
  ├── workspaceId           UUID (FK → workspaces, cascade delete)
  ├── name                  TEXT (required)
  ├── systemPrompt          TEXT (optional)
  ├── model                 TEXT (default: "gpt-4o-mini")
  ├── temperature            REAL (default: 0.7, range 0-2)
  ├── systemLevelAccess     BOOLEAN (default: false)
  ├── canManageKB           BOOLEAN (default: false)
  ├── canManageSkills       BOOLEAN (default: false)
  ├── canManageTools        BOOLEAN (default: false)
  ├── canManageSchedules    BOOLEAN (default: false)
  ├── canManageChannels     BOOLEAN (default: false)
  ├── canManageAgents       BOOLEAN (default: false)
  ├── canManageBucket       BOOLEAN (default: false)
  ├── canExecutePython      BOOLEAN (default: true)
  ├── requireApprovalForAll BOOLEAN (default: false)
  ├── browserType           TEXT (default: "cloud" | "extension")
  ├── browserEnabled        BOOLEAN (default: true)
  ├── browserProxyId        UUID (FK → browser_proxies, set null on delete)
  ├── isCeo                 BOOLEAN (default: false)
  ├── agentType             TEXT (default: "agent", values: "agent" | "ceo")
  ├── createdAt             TIMESTAMP
  └── updatedAt             TIMESTAMP
```

### Create Agent Form

The frontend provides a side-panel sheet (`CreateAgentSheet`) with:

| Field | Type | Description |
|-------|------|-------------|
| **Name** | Text input | Agent's display name (e.g. "Customer Support Agent") |
| **System Prompt** | Textarea | Custom instructions for the agent's behavior |
| **Model** | Model picker | Select from available LLM models |
| **Temperature** | Slider (0-2) | Controls randomness: 0 = precise, 2 = creative |
| **Browser Type** | Toggle cards | "Cloud Browser" (managed instance) or "Extension Browser" (real Chrome) |

---

## API Endpoints

### Agent CRUD

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/agents` | List all agents in the workspace |
| `POST` | `/api/agents` | Create a new agent |
| `GET` | `/api/agents/:id` | Get agent details |
| `PUT` | `/api/agents/:id` | Update agent configuration |
| `DELETE` | `/api/agents/:id` | Delete an agent (cascades to sessions, schedules, permissions) |

### System Permissions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `PUT` | `/api/agents/:id/system-permissions` | Update agent's system-level permissions |

### Resource Permissions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/agents/:agentId/permissions` | Get all resource permissions for an agent |
| `POST` | `/api/agents/:agentId/permissions` | Set resource permissions (batch) |

### Debug

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/agents/:id/debug/context` | Get agent's memories and notebook entries |

---

## Create Agent Request

```json
POST /api/agents
Content-Type: application/json
Authorization: Bearer <token>
x-workspace-id: <workspace-id>

{
  "name": "Research Assistant",
  "systemPrompt": "You are a research assistant that helps find and summarize information.",
  "model": "anthropic/claude-sonnet-4-20250514",
  "temperature": 0.3,
  "browserType": "cloud"
}
```

**Validation (Zod):**
- `name` -- required, min 1 character
- `systemPrompt` -- optional
- `model` -- string, defaults to `gpt-4o-mini`
- `temperature` -- number 0-2, defaults to 0.7
- `browserType` -- `"cloud"` or `"extension"`, defaults to `"cloud"`

---

## System Permissions

System permissions are boolean flags on the agent that control what platform-level actions it can perform. These are set via the permissions page in the UI.

| Permission | Default | What It Enables |
|------------|---------|-----------------|
| `systemLevelAccess` | `false` | Master switch for system-level operations |
| `canManageKB` | `false` | Create, delete KBs; add documents via `system_create_kb`, `system_delete_kb`, `system_add_document` tools |
| `canManageSkills` | `false` | Create, update, delete skills via system tools |
| `canManageTools` | `false` | Create, update, delete tools via system tools |
| `canManageSchedules` | `false` | Create, update, delete cron schedules via system tools |
| `canManageChannels` | `false` | Manage Slack/Telegram channel connections |
| `canManageAgents` | `false` | Create and modify other agents |
| `canManageBucket` | `false` | Manage workspace file storage |
| `canExecutePython` | `true` | Run Python code in sandboxed environment |
| `requireApprovalForAll` | `false` | Every tool call requires user approval before execution |

**Update request:**

```json
PUT /api/agents/:id/system-permissions

{
  "systemLevelAccess": true,
  "canManageKB": true,
  "canManageSkills": false,
  "canManageTools": false,
  "canManageSchedules": true,
  "canManageChannels": false,
  "canManageAgents": false,
  "canManageBucket": true,
  "canExecutePython": true
}
```

---

## Resource Permissions

Resource permissions control which specific tools, knowledge bases, skills, and other agents an agent can access. These are managed as a separate `agent_permissions` table.

```sql
agent_permissions
  ├── agentId       UUID (FK → agents)
  ├── resourceType  ENUM: "tool", "kb", "skill", "agent"
  ├── resourceId    UUID (the specific resource's ID)
  └── allowed       BOOLEAN (default: true)
```

**Set permissions request:**

```json
POST /api/agents/:agentId/permissions

{
  "permissions": [
    { "resourceType": "kb", "resourceId": "uuid-of-kb-1", "allowed": true },
    { "resourceType": "kb", "resourceId": "uuid-of-kb-2", "allowed": true },
    { "resourceType": "tool", "resourceId": "uuid-of-mcp-tool", "allowed": true },
    { "resourceType": "agent", "resourceId": "uuid-of-other-agent", "allowed": true }
  ]
}
```

This allows fine-grained control: Agent A can access KB #1 and #2 but not KB #3, can use Tool X but not Tool Y, can delegate to Agent B but not Agent C.

---

## Model Selection

Agents select from models stored in the `llm_models` table, seeded on startup with 18+ models:

| Provider | Models |
|----------|--------|
| **OpenAI** | GPT-5.x series variants |
| **Anthropic** | Claude Haiku, Sonnet, Opus |
| **Google** | Gemini variants |
| **DeepSeek** | DeepSeek models |
| **Meta** | Llama models |

Each model has:
- `multiplier` -- Cost multiplier for credit calculation
- `contextWindow` -- Maximum token context
- `minimumPlan` -- Required plan tier (free, starter, pro, scale)
- `isFeatured` -- Highlighted in the model picker

**Model resolution at runtime:**

1. Look up the requested model in `llm_models`
2. If found and plan tier is sufficient, use it
3. If plan-gated, fall back to the best available model for the workspace's plan
4. If no models in DB at all, use the requested model ID with default multiplier 1.0

All LLM calls route through **OpenRouter** as the gateway, regardless of the underlying provider.

---

## Agent Graph (LangGraph)

The agent's execution engine is a LangGraph `StateGraph` defined in `backend/src/graphs/agent.graph.ts` (2300+ lines). This is the core of the platform.

### Graph State

```typescript
const AgentState = {
  messages: MessagesAnnotation,    // Conversation history
  summary: string,                 // Conversation summary (for long chats)
  todos: Todo[],                   // Agent's internal task list
  step_count: number,              // Tool iteration counter
};
```

### Key Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `SUMMARIZE_THRESHOLD` | 30 | Auto-summarize when messages exceed this count |
| `KEEP_MESSAGES` | 10 | Keep the last N messages after summarization |
| `MAX_TOOL_ITERATIONS` | 25 | Maximum tool calls before graceful termination |
| `AGENT_RECURSION_LIMIT` | 50 | Hard safety limit on LangGraph recursion |
| `GRAPH_CACHE_TTL_MS` | 120000 | Cache compiled graphs for 2 minutes |

### Graph Compilation

When a chat message is received, the graph is compiled with:

1. **Agent configuration** -- model, temperature, system prompt
2. **System prompt** -- Built dynamically from agent identity + capabilities
3. **Tools** -- All assigned tools, MCP servers, Composio integrations, built-in tools
4. **Knowledge base context** -- RAG results injected into context
5. **Skills** -- Instruction sets appended to system prompt
6. **Memory** -- Per-user long-term memories loaded from DB
7. **Procedural memory** -- Tool-scoped learnings from PostgresStore (with semantic search)
8. **Notebook** -- Persistent scratchpad entries
9. **Channel info** -- Connected Slack/Telegram channel context

**Graph caching:** Compiled graphs are cached per `agentId:workspaceId:userId` for 2 minutes to avoid expensive DB queries, MCP connections, and Composio API calls on every message. The cache is invalidated when agent config changes.

### Intelligence Features

**Tool usage summary:** Before each LLM call, the graph scans conversation history and builds a summary of succeeded/failed tool calls, including Composio-specific tool slug tracking. This prevents the LLM from repeating failed tool calls.

**Correction detection:** The graph detects user correction signals (phrases like "no, not that", "wrong approach", "I meant X") and multiple tool failures to trigger deeper reflection.

**Procedural memory:** Tool-scoped learnings are stored in PostgresStore with vector embeddings. When an agent discovers the right way to use a tool, that learning is saved and loaded for all future conversations across all agents in the workspace.

**Message sanitization:** Handles orphaned tool calls/responses (required for providers like Gemini), and recovers tool calls that the LLM outputs as JSON text instead of proper API tool calls.

---

## Agent Capabilities (System Prompt Builder)

At runtime, the system prompt is built dynamically from the agent's configured capabilities:

```typescript
interface AgentCapabilities {
  kbs: KBCapability[];                    // Assigned knowledge bases
  skills: SkillCapability[];              // Assigned skills
  tools: ToolCapability[];                // Function tools
  mcpServers: MCPServerCapability[];      // MCP server tools
  hasBrowser: boolean;                    // Cloud browser available
  hasExtensionBrowser: boolean;           // Extension browser available
  browserProfileName: string;             // Browser profile name
  connectedAgents: ConnectedAgent[];      // Agents this agent can delegate to
  composioIntegrations: ComposioIntegration[];  // Connected Composio toolkits
  channels: ChannelInfo[];               // Connected Slack/Telegram channels
  systemLevelAccess: boolean;            // System management enabled
  systemPermissions: SystemPermissions;  // Granular system permissions
}
```

The system prompt builder is a pure function (no async, no DB calls) that assembles:
1. Agent identity and current date/time
2. Available tool descriptions
3. Knowledge base context
4. Skill instructions
5. Channel connection details
6. System permission descriptions

---

## Browser Automation

Each agent can use one of two browser modes:

### Cloud Browser
- Managed Chromium instance via the browser-service (Python/Flask)
- Automatic browser profile creation per agent
- Proxy support with health checking and failover
- CAPTCHA solving via Capsolver
- Screenshots streamed via WebSocket

### Extension Browser
- Controls the user's real Chrome browser via the pushable-relay extension
- Connects through the extension-bridge WebSocket relay
- Operates in the user's actual browsing context (cookies, logins, etc.)

Browser type is set per agent (`browserType: "cloud" | "extension"`).

---

## Agent Debug Info

The debug panel in the chat interface shows real-time information about the agent:

```typescript
interface AgentDebugInfo {
  agentName: string;
  modelId: string;
  modelDisplayName: string;
  temperature: number;
  systemPrompt: string;
  tools: Array<{ name: string; description: string; type: string }>;
  capabilities: {
    kbCount: number;
    skillCount: number;
    toolCount: number;
    mcpServerCount: number;
    hasBrowser: boolean;
    hasExtensionBrowser: boolean;
    connectedAgentCount: number;
    composioIntegrationCount: number;
    channelCount: number;
    systemLevelAccess: boolean;
  };
  kbs: Array<{ name; description; documentCount }>;
  skills: Array<{ name; description }>;
  mcpServers: Array<{ name; toolNames }>;
  connectedAgents: Array<{ name; role }>;
  composioIntegrations: Array<{ app; connectionLabel }>;
  channels: Array<{ name; channelType }>;
}
```

This is cached alongside the compiled graph and emitted to the frontend at the start of each chat run.

---

## Agent Deletion

Deleting an agent cascades to:
- All **sessions** and their messages
- All **runs** associated with those sessions
- All **schedules** linked to the agent
- All **agent_integrations** records
- All **agent_permissions** records
- The agent's **graph cache** is invalidated

The agent's **browser profile** and **browser sessions** have their `agentId` set to null (not deleted) to allow cleanup.

---

## CEO Agent

Each workspace has exactly one CEO agent, auto-created on first access via `GET /api/agents/ceo`.

- **One per workspace** -- The CEO is identified by `is_ceo = true`. If none exists, it is created automatically with sensible defaults.
- **CEO-specific system prompt** -- The CEO receives a specialized system prompt focused on project management, delegation, and oversight rather than task execution.
- **CEO tools only** -- The CEO gets CEO tools (project/milestone/agent management, `ceo_message_agent`) plus system tools. It does NOT receive browser tools, planning tools, or execution-level tools. The CEO manages and delegates.
- **Full system permissions** -- The CEO is created with all system permissions enabled (`systemLevelAccess`, `canManageKB`, `canManageSkills`, `canManageTools`, `canManageSchedules`, `canManageChannels`, `canManageAgents`, `canManageBucket`).

---

## Next Steps

- [Chat & Conversations](./05-chat-conversations.md) -- Real-time chat with streaming responses
- [Agent Tools](./06-agent-tools.md) -- All built-in and external tool integrations
