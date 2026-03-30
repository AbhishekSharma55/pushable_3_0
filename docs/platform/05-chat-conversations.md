# Chat & Conversations

The chat system is how users interact with AI agents. It supports real-time streaming, file attachments, tool call visualization, Human-in-the-Loop (HITL) approval, and a debug panel.

---

## Architecture

```
Frontend (browser)                          Backend (Fastify)
┌─────────────────┐                        ┌─────────────────────────┐
│                  │  POST /sessions/:id/chat  │                         │
│  Chat UI        │ ─────────────────────> │  Create run record      │
│                  │   (message + files)    │  Save user message      │
│                  │                        │  Start graph execution  │
│                  │                        │  Return { runId }       │
│                  │  GET /runs/:id/events  │                         │
│  SSE Listener   │ <────────────────────  │  RunEventBus            │
│                  │  (Server-Sent Events)  │  Streams: content,      │
│                  │                        │  toolCalls, thinking,   │
│                  │                        │  approvalRequests,      │
│                  │                        │  debug info, [DONE]     │
└─────────────────┘                        └─────────────────────────┘
```

The chat uses a **two-phase approach**:
1. **POST** to start a run -- returns a `runId` immediately
2. **GET** (SSE) to stream events -- connects to the run's event stream

This decouples the HTTP request from the (potentially long-running) agent execution.

---

## Sessions

Sessions represent individual conversations with an agent. Each session belongs to one agent and one workspace.

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/agents/:agentId/sessions` | List sessions for an agent |
| `POST` | `/api/agents/:agentId/sessions` | Create a new session |
| `DELETE` | `/api/agents/:agentId/sessions/:id` | Delete a session (cascades to messages and runs) |
| `GET` | `/api/sessions` | List all sessions in the workspace |
| `GET` | `/api/sessions/:id/messages` | Get message history for a session |
| `GET` | `/api/sessions/:id/browser-session` | Get active browser session for a chat session |

### Create Session

```json
POST /api/agents/:agentId/sessions
{
  "title": "Research task"
}
```

---

## Sending Messages

### POST `/api/sessions/:sessionId/chat`

Supports two content types:

**JSON body (text only):**
```json
{
  "message": "What is the weather in London?"
}
```

**Multipart form data (with file attachments):**
```
Content-Type: multipart/form-data

message: "Analyze this document"
file: <binary file data>
```

### What happens on message send:

1. Parse message and optional file attachments
2. Process files through `fileProcessingService`:
   - Images (PNG, JPG, GIF, WebP) -- converted to base64 data URLs
   - PDFs -- text extracted via pdfjs-dist
   - DOCX -- text extracted via mammoth
   - CSV, Markdown, Text -- read as raw text
   - Max 20MB per file
3. Persist uploaded files to workspace bucket (`/chat-uploads` folder)
4. Check for concurrent runs -- only one run per session at a time (throws `409` if active run exists)
   - Exception: stale interrupted runs older than 1 hour are auto-cancelled
5. Save user message to `messages` table (with attachment metadata)
6. Create a `run` record with status `in_progress`
7. Initialize the `RunEventBus` buffer for this run
8. Start graph execution in the background (detached from HTTP response)
9. Return `{ runId }` to the frontend immediately

### File Attachment Handling

When the agent receives files:

- **Images** -- Sent as multimodal content (image_url blocks) if the model supports vision. If not, a note is added telling the agent the model can't process images.
- **Documents** -- Text content is prepended to the user message as context:
  ```
  --- Attached file: report.pdf ---
  <extracted text content>
  --- End of report.pdf ---

  <user's message>
  ```

---

## Streaming Events (SSE)

### GET `/api/runs/:runId/events`

This is a **Server-Sent Events (SSE)** endpoint. The frontend connects to it after receiving the `runId` from the chat POST.

**Connection flow:**
1. Frontend POSTs message, gets `runId`
2. Frontend opens SSE connection to `/api/runs/:runId/events`
3. Backend replays any buffered events (supports reconnection)
4. Backend streams live events as the agent executes
5. Stream ends with `[DONE]` event

**Optional query param:** `?from=N` to skip the first N events (used when reconnecting with a snapshot).

### Event Types

Each event is a JSON object wrapped in SSE format: `data: {...}\n\n`

#### `content`
Streamed text tokens from the LLM response.
```json
{ "type": "content", "data": { "content": "The weather in " }, "timestamp": 1711234567890 }
```

#### `toolCall`
A tool being invoked or completed.
```json
{
  "type": "toolCall",
  "data": {
    "toolCall": {
      "id": "tc-123",
      "name": "browser_navigate",
      "args": "url: https://weather.com",
      "fullArgs": { "url": "https://weather.com" },
      "type": "tool",
      "status": "running"
    }
  },
  "timestamp": 1711234567890
}
```

When the tool completes:
```json
{
  "type": "toolCall",
  "data": {
    "toolCall": {
      "id": "tc-123",
      "name": "browser_navigate",
      "type": "tool",
      "status": "done",
      "result": "Navigated to https://weather.com successfully"
    }
  }
}
```

**Agent delegation** tool calls have `type: "agent"` and display as "Delegating to <agent name>".

#### `thinkingContent`
Extended thinking / chain-of-thought from Claude or reasoning content from DeepSeek.
```json
{ "type": "thinkingContent", "data": { "thinkingContent": "Let me analyze..." }, "timestamp": ... }
```

#### `browserAgentThinking`
Thinking content from the browser automation sub-agent.
```json
{ "type": "browserAgentThinking", "data": { "browserAgentThinking": "I need to click..." }, "timestamp": ... }
```

#### `approvalRequest`
An HITL interrupt -- the agent is paused and waiting for user approval.
```json
{
  "type": "approvalRequest",
  "data": {
    "approvalRequest": {
      "toolCalls": [
        {
          "id": "tc-456",
          "name": "system_delete_kb",
          "args": { "kbId": "...", "confirmName": "..." }
        }
      ]
    }
  }
}
```

#### `debug`
Agent debug information emitted at the start of a run.
```json
{
  "type": "debug",
  "data": {
    "debug": {
      "agentName": "Research Assistant",
      "modelId": "anthropic/claude-opus-4.6",
      "temperature": 0.3,
      "tools": [...],
      "capabilities": { "kbCount": 2, "toolCount": 5, ... }
    }
  }
}
```

#### `error`
An error occurred during execution.
```json
{ "error": "An error occurred while processing your message." }
```

#### `[DONE]`
The stream is complete.
```
data: [DONE]
```

---

## Human-in-the-Loop (HITL) Approval

When an agent has `requireApprovalForAll: true` or attempts a sensitive operation, the LangGraph `interrupt()` function pauses execution and sends an approval request to the user.

### Approval Flow

```
1. Agent decides to call a tool
2. Graph checks if approval is required
3. If yes: interrupt() is called
4. Graph state is checkpointed to PostgreSQL
5. "approvalRequest" event is emitted via SSE
6. Frontend displays an approval card with the tool call details
7. User clicks Approve, Edit, or Reject
8. Frontend POSTs to /sessions/:id/chat/approve
9. Backend resumes the graph with the user's decision
10. Execution continues (or stops if rejected)
```

### POST `/api/sessions/:sessionId/chat/approve`

```json
{
  "decisions": [
    {
      "type": "approve",
      "args": {},
      "message": ""
    }
  ]
}
```

Decision types:
- `"approve"` -- Execute the tool call as-is
- `"edit"` -- Execute with modified arguments (provided in `args`)
- `"reject"` -- Cancel the tool call (agent receives rejection message)

After approval, the graph resumes by streaming a `Command({ resume: { decisions } })` through the same SSE event bus. Further interrupts may occur in the same run.

---

## Run Lifecycle

Each message creates a **run** that tracks the agent's execution:

```sql
runs
  ├── id          UUID
  ├── sessionId   UUID (FK → sessions)
  ├── workspaceId UUID (FK → workspaces)
  ├── status      ENUM: queued, in_progress, completed, failed, interrupted, cancelled
  ├── error       TEXT (failure message)
  ├── createdAt   TIMESTAMP
  └── updatedAt   TIMESTAMP
```

### Status Flow

```
          ┌─────────────────────┐
          │     in_progress     │
          └──────────┬──────────┘
                     │
         ┌───────────┼───────────┐
         │           │           │
    ┌────▼───┐  ┌────▼────┐  ┌──▼───────┐
    │completed│  │  failed │  │interrupted│
    └────────┘  └─────────┘  └──────┬───┘
                                    │
                              User approves
                                    │
                              ┌─────▼─────┐
                              │in_progress │ (resumed)
                              └─────┬─────┘
                                    │
                           ┌────────┼────────┐
                           │        │        │
                      completed  failed  interrupted
```

**Concurrency guard:** Only one run can be active per session. If a user sends a message while a run is in progress, the API returns `409 RUN_IN_PROGRESS`. Exception: stale interrupted runs (>1 hour) are auto-cancelled.

---

## Message Storage

Messages are persisted in the `messages` table:

```sql
messages
  ├── id          UUID
  ├── workspaceId UUID (FK → workspaces)
  ├── sessionId   UUID (FK → sessions)
  ├── role        ENUM: "user", "assistant", "tool"
  ├── content     TEXT
  ├── tokenCount  INTEGER
  ├── metadata    JSONB (tool calls, segments, approval requests, thinking)
  └── createdAt   TIMESTAMP
```

### Message Metadata

Assistant messages store rich metadata:

```json
{
  "toolCalls": [
    { "id": "tc-1", "name": "browser_navigate", "status": "done", "result": "..." }
  ],
  "segments": [
    { "type": "text", "content": "Let me look that up..." },
    { "type": "tools", "toolCalls": [{ "id": "tc-1", ... }] },
    { "type": "text", "content": "Here's what I found:" }
  ],
  "approvalRequest": { ... },
  "thinking": "Extended thinking content..."
}
```

**Segments** maintain the interleaving of text and tool calls for accurate UI rendering.

User messages with attachments store:
```json
{
  "attachments": [
    {
      "filename": "report.pdf",
      "mimetype": "application/pdf",
      "type": "document",
      "size": 245678,
      "bucketFileId": "uuid-of-stored-file"
    }
  ]
}
```

---

## Conversation Summarization

When a conversation exceeds **30 messages**, the graph automatically triggers summarization:

1. All messages except the last **10** are summarized by the LLM
2. The summary is stored in the graph state
3. Older messages are removed (using `RemoveMessage`)
4. The summary is injected as a `SystemMessage` before the remaining messages
5. This prevents context window overflow while preserving conversation history

The summarization node is skipped in the SSE stream -- users never see the summary as a chat message.

---

## RunEventBus

The `RunEventBus` (`backend/src/lib/run-event-bus.ts`) is an in-memory event buffer and pub/sub system:

- **`init(runId)`** -- Create a buffer for a new run
- **`emit(runId, event)`** -- Buffer an event and notify subscribers
- **`subscribe(runId, callback)`** -- Listen for new events
- **`complete(runId)`** -- Mark run as done
- **`fail(runId, error)`** -- Mark run as failed
- **`markInterrupted(runId)`** -- Set a safety timeout for interrupted runs
- **`clearInterruptedTimeout(runId)`** -- Clear timeout when approval is received
- **`hasEvents(runId)`** -- Check if events exist in memory

Events are buffered so that SSE clients can reconnect and replay the full history. The buffer is cleaned up after the run completes and the client disconnects.

---

## Content Sanitization

The streaming pipeline sanitizes LLM output:

1. **`stripToolCallXml(chunk)`** -- Removes tool-call XML that leaks into content during streaming (real-time, per-chunk)
2. **`stripToolCallXmlFinal(content)`** -- Final pass on accumulated content before persistence
3. **`recoverToolCallsFromText(content)`** -- Detects tool calls serialized as JSON text (a known Claude intermittent issue) and converts them to proper tool calls

---

## Frontend Chat Components

### Chat UI
The main chat interface renders:
- Message history with user/assistant bubbles
- Tool call visualizations showing name, arguments, and result
- Approval cards with Approve/Edit/Reject buttons
- Artifact panel for file previews (HTML, Markdown, CSV, XLSX, PDF, text)
- Debug log panel with collapsible sections

### Debug Panel
Shows real-time agent information:
- Agent config (name, model, temperature)
- System prompt
- Available tools with descriptions
- Connected KBs, skills, MCP servers
- Connected agents, Composio integrations, channels
- Thinking/reasoning content
- Tool call history with results

### useChatWs Hook
The frontend's WebSocket chat hook (`frontend/src/hooks/useChatWs.ts`) manages:
- Sending messages (POST to chat endpoint)
- SSE connection for streaming events
- Message state management
- Debug log accumulation
- Approval request handling

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Concurrent run on same session | `409 RUN_IN_PROGRESS` |
| Empty message and no files | `400 EMPTY_REQUEST` |
| File processing failure | `400 FILE_PROCESSING_ERROR` |
| Run not found | `404 RUN_NOT_FOUND` |
| GraphRecursionError | Completes gracefully with streamed content |
| Unhandled execution error | Run status set to `failed`, error emitted via SSE |
| Stale interrupted run (>1 hour) | Auto-cancelled, new message proceeds |

---

## Next Steps

- [Agent Tools](./06-agent-tools.md) -- Built-in and external tool integrations
- [Browser Automation](./07-browser-automation.md) -- Cloud and extension browser modes
