# Agent Tools

Tools are capabilities that agents can invoke during conversations. Pushable AI provides 9 categories of built-in tools plus support for MCP servers, Composio integrations, and agent delegation.

---

## Tool Architecture

Tools are built as LangChain `DynamicStructuredTool` instances with Zod schema validation. During graph compilation, all applicable tools are assembled based on the agent's configuration and permissions.

```
Agent Graph Compilation
  ├── Built-in tools (based on system permissions)
  │     ├── System tools (KB, skill, tool, schedule management)
  │     ├── Browser tools (cloud or extension)
  │     ├── Python tools
  │     ├── Bucket tools (file storage)
  │     ├── Vault tools (credential access)
  │     ├── Memory tools
  │     ├── Planning tools
  │     └── Notebook tools
  ├── MCP server tools (from assigned MCP tools)
  ├── Composio integration tools (from connected integrations)
  └── Agent delegation tools (from connected agents)
```

---

## 1. System Tools

**File:** `backend/src/tools/system.tools.ts`
**Gated by:** Individual system permission flags

System tools let agents manage platform resources. Each tool is only available if the corresponding permission is enabled.

### KB Management (requires `canManageKB`)

| Tool | Description |
|------|-------------|
| `system_create_kb` | Create a new knowledge base |
| `system_delete_kb` | Delete a KB (requires name confirmation for safety) |
| `system_add_document` | Add a text document to a KB (auto-chunks and embeds) |

### Skill Management (requires `canManageSkills`)

| Tool | Description |
|------|-------------|
| `system_create_skill` | Create a new skill with instructions |
| `system_update_skill` | Update a skill's name, description, or instructions |
| `system_delete_skill` | Delete a skill |

### Tool Management (requires `canManageTools`)

| Tool | Description |
|------|-------------|
| `system_create_tool` | Create a new tool definition |
| `system_update_tool` | Update a tool's configuration |
| `system_delete_tool` | Delete a tool |

### Schedule Management (requires `canManageSchedules`)

| Tool | Description |
|------|-------------|
| `system_create_schedule` | Create a cron schedule for any agent |
| `system_update_schedule` | Update schedule configuration |
| `system_delete_schedule` | Delete a schedule |
| `system_list_schedules` | List all schedules in the workspace |

### Channel Management (requires `canManageChannels`)

| Tool | Description |
|------|-------------|
| `system_list_channels` | List connected channels |

### Agent Management (requires `canManageAgents`)

| Tool | Description |
|------|-------------|
| `system_create_agent` | Create a new agent |
| `system_update_agent` | Update agent configuration |

---

## 2. Browser Tools

**File:** `backend/src/tools/browser.tools.ts`
**Gated by:** `browserEnabled` flag on agent

Browser tools provide web automation capabilities. The specific tools depend on the browser type.

### Cloud Browser

Uses the Python browser-service to manage headless Chromium instances.

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to a URL |
| `browser_click` | Click an element on the page |
| `browser_type` | Type text into an input field |
| `browser_scroll` | Scroll the page |
| `browser_screenshot` | Take a screenshot |
| `browser_get_page_state` | Get current page interactive elements |
| `browser_wait` | Wait for an element or condition |

**Proxy support:** On session creation, the system picks a healthy proxy:
1. Tests the agent's preferred proxy
2. If it fails, tries other active proxies in the workspace
3. Falls back to no proxy if all fail

**Auto-creation:** If an agent has no browser profile, one is automatically created on first use.

### Extension Browser

Uses the pushable-relay Chrome extension via the extension-bridge.

The browser agent tool (`browser_agent`) wraps the extension bridge client and delegates browsing tasks to a sub-agent that operates in the user's real browser.

### Browser Agent Sub-loop

Both browser modes use a sub-agent loop:
1. The main agent calls `browser_agent` with a task description
2. A sub-agent receives the task + current page state
3. The sub-agent plans and executes browser actions
4. Page state is refreshed after each action
5. Sub-agent continues until the task is complete
6. Results are returned to the main agent

Browser events (tool_start, tool_end, thinking) are streamed to the frontend in real-time.

---

## 3. Python Tools

**File:** `backend/src/tools/python.tools.ts`
**Gated by:** `canExecutePython` permission (default: `true`)

| Tool | Description |
|------|-------------|
| `python_execute` | Execute Python code in a sandboxed environment |

### Capabilities

- **Runtime:** Python 3
- **Available libraries:** numpy, pandas, scipy, sympy, matplotlib, math, statistics, json, csv, datetime, re, collections, itertools
- **Timeout:** 1-30 seconds (default 15)
- **Output:** Only `print()` output is captured
- **Safety:** Runs in `python-sandbox.service.ts` with process isolation

### Example Usage

The agent can use this for:
- Arithmetic, algebra, calculus, symbolic math (sympy)
- Data analysis (pandas, numpy)
- Statistical analysis
- Chart generation (matplotlib)
- Data formatting and transformation

---

## 4. Bucket Tools (File Storage)

**File:** `backend/src/tools/bucket.tools.ts`
**Always available** (agents can always read; write gated by `canManageBucket`)

| Tool | Description |
|------|-------------|
| `bucket_save_file` | Save a file to workspace storage |
| `bucket_read_file` | Read a file's contents |
| `bucket_update_file` | Update an existing file's content in-place (text files only) |
| `bucket_list_files` | List files in the workspace bucket |
| `bucket_delete_file` | Delete a file |

### bucket_save_file

Saves files with:
- **Filename** with extension (determines MIME type)
- **Content** as text or base64-encoded binary
- **Folder** path (defaults to `/agent-output`)
- **Description** for metadata

Supported MIME types are auto-detected from extension: `.txt`, `.md`, `.csv`, `.json`, `.html`, `.xml`, `.pdf`, `.png`, `.jpg`, `.gif`, `.webp`

### bucket_update_file

Updates an existing text file's content in-place (overwrites). Accepts `fileId` or `filename` to locate the file, and `content` with the new full content. Only works for text-based MIME types (text/*, application/json, application/xml, application/javascript). Used heavily for the "Bucket as Database" CSV tables pattern.

### Bucket as Database (CSV Tables)

Agents can use the bucket as a lightweight database by storing structured data in CSV files. Each CSV file acts as a table — rows are records, columns are fields. The system prompt instructs agents to:
- Use naming convention `db_{table_name}.csv` (e.g., `db_leads.csv`, `db_tasks.csv`)
- Always include `id` and `created_at` columns
- Use `bucket_update_file` to modify rows in-place
- Save table metadata to notebook (key: `bucket_db_{table_name}`) for cross-session persistence
- Save a memory that the user uses bucket-as-DB so it carries across sessions
- Use `python_execute` with pandas for queries, filtering, and aggregation on larger tables

This is offered as a fallback when the user has no external integrations (Google Sheets, Airtable, etc.) connected.

Files are stored in MinIO (dev) or S3 (prod) and tracked in the `bucket_files` table.

---

## 5. Vault Tools

**File:** `backend/src/tools/vault.tools.ts`
**Gated by:** Active Bitwarden vault connection for the workspace

| Tool | Description |
|------|-------------|
| `vault_get_credential` | Fetch login credentials from Bitwarden vault |

### How it works

1. Searches the user's Bitwarden vault by item name (e.g., "Facebook", "Gmail")
2. Returns username, password, and URI
3. Agent uses credentials to fill login forms during browser automation

**Security:** The tool description explicitly instructs the agent to never display or log the returned password -- only use it to fill forms.

Vault tools are only built if the workspace has an active vault connection (`vault_connections.status = 'active'`).

---

## 6. Memory Tools

**File:** `backend/src/tools/memory.tools.ts`
**Always available**

| Tool | Description |
|------|-------------|
| `save_memory` | Save information about the user to long-term memory |

### What to save

The tool is designed to aggressively save:
- User preferences and facts
- Processes, workflows, and step-by-step instructions
- Rules, patterns, and SOPs
- Project-specific knowledge
- Corrections to the agent's approach

### Memory categories

- `preference` -- User preferences
- `fact` -- Factual information about the user
- `decision` -- Decisions made by the user
- `process` -- Workflows, instructions, how-to procedures
- `general` -- Catch-all category

Memories are **per-user, per-agent** and stored in the `agent_memories` table. They are loaded into the system prompt at the start of each conversation.

---

## 7. Planning Tools

**File:** `backend/src/tools/planning.tools.ts`
**Always available**

| Tool | Description |
|------|-------------|
| `write_todos` | Create or replace the agent's internal task plan |
| `update_todo` | Update a todo's status (pending → in_progress → completed) |

### How it works

The agent creates a plan at the start of complex tasks:

```
write_todos([
  { id: "step_1", title: "Research competitor pricing" },
  { id: "step_2", title: "Compile comparison table" },
  { id: "step_3", title: "Draft summary report" }
])
```

Then updates each step as it progresses:

```
update_todo({ id: "step_1", status: "in_progress" })
// ... does the work ...
update_todo({ id: "step_1", status: "completed", result: "Found 5 competitors" })
```

Todos are stored in the LangGraph state and persist across turns via the PostgreSQL checkpointer. They are **not** visible to the user directly but help the agent stay organized.

---

## 8. Notebook Tools

**File:** `backend/src/tools/notebook.tools.ts`
**Always available**

| Tool | Description |
|------|-------------|
| `write_notebook` | Save a working reference to persistent storage |
| `read_notebook` | Read all notebook entries |
| `delete_notebook_entry` | Remove a notebook entry |

### Notebook vs Memory

| Aspect | Memory (save_memory) | Notebook (write_notebook) |
|--------|---------------------|--------------------------|
| **Stores** | Facts *about the user* | Working references *the agent needs* |
| **Examples** | "User prefers dark mode" | `leads_sheet_id = "1BxiMVs..."` |
| **Persistence** | Database table | LangGraph PostgresStore |
| **Scope** | Per-user, per-agent | Per-user, per-agent |
| **Namespace** | `agent_memories` table | `[workspaceId, agentId, userId, "notebook"]` |

Notebook entries survive across sessions and context compression. They store operational context like Google Sheet IDs, API endpoints, resource handles, and intermediate results.

---

## MCP Server Tools

**Type:** `mcp` in the `tools` table
**Assigned via:** Resource permissions

MCP (Model Context Protocol) tools connect to external MCP servers that expose tool definitions.

### How it works

1. Admin creates an MCP tool in the Tools page with server configuration (URL, transport, etc.)
2. The tool is assigned to an agent via resource permissions
3. During graph compilation, the `MultiServerMCPClient` connects to all assigned MCP servers
4. Tool definitions are discovered from the servers and made available to the agent
5. When the agent invokes an MCP tool, the call is proxied to the MCP server

### Tool Configuration

```json
{
  "name": "GitHub Tools",
  "type": "mcp",
  "config": {
    "url": "http://localhost:3005/mcp",
    "transport": "sse"
  }
}
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tools` | List all tools in workspace |
| `POST` | `/api/tools` | Create a new tool |
| `GET` | `/api/tools/:id` | Get tool details |
| `PUT` | `/api/tools/:id` | Update tool configuration |
| `DELETE` | `/api/tools/:id` | Delete a tool |

### Create Tool

```json
POST /api/tools
{
  "name": "My MCP Server",
  "description": "Custom tool server",
  "type": "mcp",
  "isGlobal": false,
  "config": {
    "url": "http://mcp-server:3005",
    "transport": "sse"
  }
}
```

- `type` -- `"mcp"` for MCP servers, `"function"` for custom function tools
- `isGlobal` -- If true, available to all workspaces (admin only)

---

## Composio Integrations

Composio provides 100+ pre-built toolkits for third-party services (Google Sheets, Gmail, Slack, GitHub, etc.).

### How it works

1. Admin connects a Composio integration via OAuth
2. The integration is assigned to an agent
3. During graph compilation, Composio tools are fetched and made available
4. The agent uses `COMPOSIO_MULTI_EXECUTE_TOOL` to call Composio actions

### Integration Flow

```
1. GET /api/integrations/toolkits     → Browse available toolkits
2. POST /api/integrations/connect     → Start OAuth connection
3. OAuth callback                      → Integration becomes active
4. Assign integration to agent         → Via resource permissions
5. Agent uses Composio tools           → During chat execution
```

### Tool Learning

The system tracks Composio tool call outcomes:
- **Succeeded tool slugs** are reused in future calls
- **Failed tool slugs** are avoided
- This is injected into the tool usage summary before each LLM call

---

## Agent Delegation

Agents can delegate tasks to other agents in the workspace.

### How it works

1. Agent A has Agent B assigned via resource permissions (type: `"agent"`)
2. During graph compilation, an `agent_<name>` tool is created for each connected agent
3. When Agent A calls `agent_research_assistant`, a new agent graph is created for Agent B
4. Agent B executes the task independently
5. The result is returned to Agent A as a tool response

### Delegation Tool

```typescript
buildAgentCallerTool({
  targetAgentId: "uuid",
  targetAgentName: "Research Assistant",
  targetRole: "Researches topics and summarizes findings",
  callerWorkspaceId: "uuid",
  callerUserId: "uuid"
})
```

The tool appears in the agent's tool list as `agent_research_assistant` with the connected agent's description.

**Credit tracking:** Delegation incurs credit costs for both the calling and called agent's LLM usage.

---

## 9. CEO Tools

CEO-only tools for managing projects, milestones, agents, and monitoring. Only injected when `agent.isCeo === true`.

| Tool | Description |
|------|-------------|
| `ceo_create_project` | Create a new project |
| `ceo_update_project` | Update project details/status |
| `ceo_delete_project` | Delete a project (requires name confirmation) |
| `ceo_list_projects` | List all projects with status/progress |
| `ceo_get_project_details` | Full project details with milestones, agents, KBs, reports |
| `ceo_create_milestone` | Add milestone to a project |
| `ceo_update_milestone` | Update milestone status/details |
| `ceo_delete_milestone` | Remove a milestone |
| `ceo_evaluate_milestones` | Auto-evaluate milestone progress from run reports |
| `ceo_assign_agent_to_project` | Assign agent to project |
| `ceo_remove_agent_from_project` | Remove agent from project |
| `ceo_assign_kb_to_project` | Link KB to project |
| `ceo_remove_kb_from_project` | Unlink KB from project |
| `ceo_get_project_reports` | Get run reports for a project |
| `ceo_get_agent_reports` | Get run reports for an agent |
| `ceo_message_agent` | Send instruction to agent, trigger on-demand run |

CEO does NOT get browser tools, planning tools, or execution-level tools. The CEO manages and delegates.

---

## Tool Execution Safety

### HITL (Human-in-the-Loop) Approval

When `requireApprovalForAll` is enabled on an agent, every tool call triggers an `interrupt()` that pauses execution and asks the user to approve, edit, or reject the tool call.

For specific tools (like `system_delete_kb`), the tool itself includes safety checks (name confirmation) regardless of the global approval setting.

### Tool Iteration Limits

| Limit | Value | Purpose |
|-------|-------|---------|
| `MAX_TOOL_ITERATIONS` | 25 | Graceful termination with summary |
| `AGENT_RECURSION_LIMIT` | 50 | Hard safety limit (LangGraph `recursionLimit`) |

When the iteration limit is reached, the agent receives a message telling it to wrap up and present its findings.

### Tool Usage Summary

Before each LLM call, the graph builds a summary of all tool calls in the conversation:

```
## Tool Usage History (This Conversation)
You have made 7 tool call(s) so far.

**FAILED tool calls (DO NOT repeat these with the same parameters):**
- ✗ browser_navigate(url=https://wrong-url.com) → 404 Not Found

**SUCCEEDED tool calls (reuse these patterns):**
- ✓ browser_navigate(url=https://correct-url.com)

**RULES:**
- If a tool call failed, do NOT call it again with the same parameters.
- If a tool call succeeded, reuse the EXACT same tool and pattern.
- Minimize total tool calls. Be precise and intentional.
```

### Procedural Memory

When agents discover the right way to use tools (e.g., correct Composio tool slugs, working API patterns), these learnings are stored as **procedural memory** in PostgresStore with vector embeddings.

- Namespace: `[workspaceId, "tool_learnings", toolName]`
- Searchable via semantic similarity (using OpenAI `text-embedding-3-small`)
- Loaded at graph compilation time for the current user's message
- **Workspace-wide** -- any agent using the same tool benefits from the learning

---

## Tool Summary Table

| Category | Tools | Permission Required |
|----------|-------|-------------------|
| **System** | system_create_kb, system_delete_kb, system_add_document, system_create_skill, system_update_skill, system_delete_skill, system_create_tool, system_update_tool, system_delete_tool, system_create_schedule, system_update_schedule, system_delete_schedule, system_list_schedules, system_list_channels, system_create_agent, system_update_agent | Individual `canManage*` flags |
| **Browser** | browser_navigate, browser_click, browser_type, browser_scroll, browser_screenshot, browser_get_page_state, browser_wait | `browserEnabled` |
| **Python** | python_execute | `canExecutePython` |
| **Bucket** | bucket_save_file, bucket_read_file, bucket_update_file, bucket_list_files, bucket_delete_file | Always available (write: `canManageBucket`) |
| **Vault** | vault_get_credential | Active vault connection |
| **Memory** | save_memory | Always available |
| **Planning** | write_todos, update_todo | Always available |
| **Notebook** | write_notebook, read_notebook, delete_notebook_entry | Always available |
| **CEO** | ceo_create_project, ceo_update_project, ceo_delete_project, ceo_list_projects, ceo_get_project_details, ceo_create_milestone, ceo_update_milestone, ceo_delete_milestone, ceo_evaluate_milestones, ceo_assign_agent_to_project, ceo_remove_agent_from_project, ceo_assign_kb_to_project, ceo_remove_kb_from_project, ceo_get_project_reports, ceo_get_agent_reports, ceo_message_agent | `agent.isCeo === true` |
| **MCP** | Dynamic (discovered from MCP servers) | Assigned via permissions |
| **Composio** | Dynamic (from connected integrations) | Assigned via permissions |
| **Delegation** | agent_<name> (one per connected agent) | Assigned via permissions |

---

## Next Steps

- [Browser Automation](./07-browser-automation.md) -- Deep dive into cloud and extension browser modes
- [Knowledge Base](./08-knowledge-base.md) -- Document upload, chunking, and semantic search
