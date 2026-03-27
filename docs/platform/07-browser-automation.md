# Browser Automation

Pushable AI gives agents the ability to browse the web, interact with pages, fill forms, and extract information. Two browser modes are available: **Cloud Browser** (managed headless Chromium) and **Extension Browser** (user's real Chrome via extension).

---

## Architecture

```
                    Cloud Browser Mode                     Extension Browser Mode
                    ──────────────────                     ──────────────────────

                    ┌──────────────┐                       ┌──────────────┐
                    │   Backend    │                       │   Backend    │
                    │ (Fastify)    │                       │ (Fastify)    │
                    └──────┬───────┘                       └──────┬───────┘
                           │ HTTP                                 │ WebSocket
                           ▼                                      ▼
                    ┌──────────────┐                       ┌──────────────┐
                    │  Browser     │                       │  Extension   │
                    │  Service     │                       │  Bridge      │
                    │  (Python)    │                       │  (Node.js)   │
                    │  :8080       │                       │  :3004       │
                    └──────┬───────┘                       └──────┬───────┘
                           │ Controls                             │ WebSocket
                           ▼                                      ▼
                    ┌──────────────┐                       ┌──────────────┐
                    │  Chromium    │                       │  Chrome      │
                    │  (headless)  │                       │  Extension   │
                    │  + Camoufox  │                       │  (pushable-  │
                    │  + Capsolver │                       │   relay)     │
                    └──────────────┘                       └──────────────┘
                                                                  │
                                                           User's real
                                                           Chrome browser
```

---

## Cloud Browser

### Browser Service (Python/Flask)

The browser-service is a Python microservice that manages headless Chromium instances.

**Key files:**
- `browser-service/src/main.py` -- Flask entry point
- `browser-service/src/browser_manager.py` -- Chromium instance lifecycle
- `browser-service/src/dom_extractor.py` -- DOM parsing and element extraction
- `browser-service/src/input_handler.py` -- Click, type, scroll simulation
- `browser-service/src/session_store.py` -- Session persistence
- `browser-service/src/captcha/` -- Capsolver integration
- `browser-service/src/routes/` -- Flask API routes
- `browser-service/src/ws/` -- WebSocket handlers for live screenshots

### Browser Service API

The backend communicates with the browser-service via HTTP (`browser-client.ts`):

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/browser/sessions` | Create a new browser session |
| `GET` | `/api/browser/sessions` | List active sessions |
| `DELETE` | `/api/browser/sessions/:id` | Close a session |
| `POST` | `/api/browser/<action>` | Execute a browser action |

### Browser Actions

Actions are sent via `POST /api/browser/<action>` with a JSON body containing `sessionId` and action-specific parameters:

| Action | Description | Parameters |
|--------|-------------|------------|
| `navigate` | Go to a URL | `url` |
| `click_element` | Click by element index | `index` |
| `type_element` | Type into input by index | `index`, `text`, `clearFirst` |
| `scroll` | Scroll the page | `direction`, `amount` |
| `screenshot` | Take a screenshot | -- |
| `get_interactive_elements` | Get page state with element indices | -- |
| `get_url` | Get current page URL | -- |
| `go_back` | Navigate back | -- |
| `go_forward` | Navigate forward | -- |
| `wait` | Wait for element/condition | `selector`, `timeout` |
| `press_key` | Press a keyboard key | `key` |
| `select_option` | Select dropdown option | `index`, `value` |

### Screenshot Streaming

The browser-service streams screenshots to the frontend via WebSocket:

- **Interval:** 200ms (configurable via `SCREENSHOT_INTERVAL_MS`)
- **Quality:** 60% JPEG (configurable via `SCREENSHOT_QUALITY`)
- **Resolution:** 1920x1080 (configurable via `SCREENSHOT_WIDTH`, `SCREENSHOT_HEIGHT`)

The frontend's `ExtensionLiveView` component connects to the WebSocket URL to display a real-time browser preview.

### CAPTCHA Solving

When `CAPSOLVER_EXTENSION_ENABLED=true` and a `CAPSOLVER_API_KEY` is set, the browser-service loads the Capsolver extension into Chromium. This automatically:
- Detects CAPTCHA challenges (reCAPTCHA, hCaptcha, Cloudflare Turnstile)
- Solves them in the background
- Allows the agent to proceed without interruption

The `browser_navigate` tool description tells the agent: "CAPTCHAs and Cloudflare challenges are solved automatically."

---

## Extension Browser

### How It Works

The extension browser mode allows agents to control the user's actual Chrome browser through the `pushable-relay` Chrome extension.

**Components:**

1. **Chrome Extension** (`pushable-relay/`) -- Installed in the user's browser
   - `manifest.json` -- Manifest V3 configuration
   - `background.js` -- WebSocket connection to bridge, command execution
   - `content.js` -- DOM interaction on web pages
   - `popup.js` -- Extension popup UI

2. **Extension Bridge** (`extension-bridge/`) -- WebSocket relay server
   - Runs as a Docker service on port 3004 (mapped from internal 3001)
   - Receives commands from the backend
   - Forwards them to the connected Chrome extension
   - Returns results back to the backend

3. **Extension Bridge Client** (`backend/src/lib/extension-bridge-client.ts`) -- Backend WebSocket client
   - Connects to `ws://extension-bridge:3001`
   - Sends commands with unique `commandId`
   - Waits for results with 30-second timeout
   - Auto-reconnects on disconnection
   - Handles ping/pong heartbeat

### Command Flow

```
1. Agent calls browser tool (e.g., browser_navigate)
2. Backend sends command via ExtensionBridgeClient
3. Bridge relays command to connected Chrome extension
4. Extension executes command in user's browser
5. Extension sends result back through bridge
6. Backend receives result and returns to agent
```

### Extension Bridge Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `EXTENSION_BRIDGE_URL` | `ws://extension-bridge:3001` | Internal WebSocket URL (backend → bridge) |
| `EXTENSION_BRIDGE_PUBLIC_URL` | `wss://ws.pushable.ai` | Public WebSocket URL (extension → bridge) |
| `EXTENSION_BRIDGE_API_KEY` | _(empty)_ | API key for authenticating bridge connections |

---

## Browser Profiles

Browser profiles persist browser state (cookies, settings, local storage) across sessions.

### Database Schema

```sql
browser_profiles
  ├── id               UUID
  ├── workspaceId      UUID (FK → workspaces)
  ├── name             TEXT (e.g., "Sales Agent Browser")
  ├── profilePath      TEXT (unique path for storage: "workspaceId/uuid")
  ├── assignedAgentId  UUID (FK → agents, set null on delete)
  ├── os               TEXT ("windows", "macos", "linux")
  ├── status           ENUM: active, inactive
  ├── createdAt        TIMESTAMP
  └── updatedAt        TIMESTAMP
```

### Auto-creation

When an agent first uses browser tools, a profile is automatically created:
- Name: `"{Agent Name} Browser"`
- OS: `"windows"` (default)
- Status: `"active"`

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/browser/profiles` | List all browser profiles |
| `POST` | `/api/browser/profiles` | Create a profile |
| `PUT` | `/api/browser/profiles/:id` | Update a profile |
| `DELETE` | `/api/browser/profiles/:id` | Delete a profile |

### Create Profile

```json
POST /api/browser/profiles
{
  "name": "Research Browser",
  "assignedAgentId": "uuid-of-agent",
  "os": "windows"
}
```

OS options: `"windows"`, `"macos"`, `"linux"` -- affects browser fingerprint.

---

## Browser Sessions

Sessions represent active browser instances.

### Database Schema

```sql
browser_sessions
  ├── id          UUID
  ├── workspaceId UUID (FK → workspaces)
  ├── profileId   UUID (FK → browser_profiles)
  ├── agentId     UUID (FK → agents, nullable)
  ├── taskId      TEXT (chat session ID, nullable)
  ├── status      ENUM: starting, active, closed, error
  ├── closedAt    TIMESTAMP (nullable)
  ├── createdAt   TIMESTAMP
  └── updatedAt   TIMESTAMP
```

### Session Lifecycle

```
1. Agent starts chat → browser tools are built
2. System checks for existing active session on the profile
   a. Same chat session? → Try to reuse (verify alive via get_url)
   b. Different chat session? → Close old session
3. If no reusable session → create new one:
   a. Pick healthy proxy (test preferred, then fallback)
   b. Call browser-service to create Chromium instance
   c. Record session in database
4. Agent uses browser tools against this session
5. Session stays active for the duration of the chat
6. On new chat or cleanup → session is closed
```

### One Session Per Profile

Only one browser session can be active per profile at a time. If a new chat starts with the same agent:
- The old session is closed
- A new session is created with the new chat context

### Session Status Sync

The backend periodically syncs session status with the browser-service:
- If the DB says a session is "active" but the browser-service doesn't have it, the status is updated to "error"
- On backend startup, all "active" and "starting" sessions are marked as "closed" (stale session cleanup)

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/browser/sessions/start` | Start a new browser session |
| `DELETE` | `/api/browser/sessions/:id` | End a browser session |
| `GET` | `/api/browser/sessions` | List all browser sessions |
| `GET` | `/api/sessions/:id/browser-session` | Get active browser session for a chat session |

---

## Browser Proxies

Proxies route browser traffic through different IP addresses, useful for avoiding rate limits and geographic restrictions.

### Database Schema

```sql
browser_proxies
  ├── id          UUID
  ├── workspaceId UUID (FK → workspaces)
  ├── label       TEXT (display name)
  ├── host        TEXT
  ├── port        INTEGER
  ├── protocol    ENUM: http, https, socks5
  ├── username    TEXT (nullable)
  ├── password    TEXT (nullable)
  ├── testStatus  ENUM: success, failed, untested
  ├── testIp      TEXT (nullable, IP from last test)
  ├── testedAt    TIMESTAMP (nullable)
  ├── createdAt   TIMESTAMP
  └── updatedAt   TIMESTAMP
```

### Proxy Selection

When a browser session starts:

1. **Preferred proxy** -- The agent's `browserProxyId` is tested first
2. **Failover** -- If preferred fails, all active workspace proxies are tried in order
3. **Auto-select** -- If no proxy is specified, the first active proxy is auto-selected
4. **No proxy** -- If all proxies fail or none exist, the session runs without a proxy

### Proxy Health Check

Before using a proxy, the system tests it by making a request through it and checking:
- Connection succeeds
- Response includes the proxy's IP

Failed proxies are skipped and the next one is tried.

### Seeded Proxies

On first startup, the backend seeds default proxy configurations for each workspace (Geonix proxies for India/Mumbai region).

---

## Browser Agent Sub-loop

When the main agent needs to perform a web task, it delegates to a browser sub-agent:

### Flow

```
1. Main agent calls browser_agent("Search for competitor pricing on example.com")
2. Browser agent tool creates a sub-agent with:
   - Browser-specific system prompt
   - Browser tools (click, type, navigate, etc.)
   - Current page state auto-injected before each LLM turn
3. Sub-agent loop:
   a. Get current page state (interactive elements, URL, scroll position)
   b. LLM decides next action
   c. Execute browser action
   d. Check if task is complete
   e. If not, loop back to (a)
4. Sub-agent returns result to main agent
5. Browser events (tool_start, tool_end, thinking) streamed to frontend
```

### Page State

Before each LLM turn, the sub-agent receives the current page state:

```
[Current Page State]
Page: Example.com - Products
URL: https://example.com/products
Scroll: 0 pages above, 2 pages below

Interactive elements (12):
[0] <a href="/home"> "Home"
[1] <a href="/products"> "Products"
[2] <input type="search" placeholder="Search...">
[3] <button> "Search"
[4] <a href="/products/widget-a"> "Widget A - $29.99"
...
```

The agent uses element indices (e.g., `[2]`) to interact with the page via `click_element` and `type_element`.

### Response Sanitization

The browser sub-agent's response is sanitized to remove:
- Page state blocks (`[Current Page State]` sections)
- HTML element fragments (`<a href="...">`)
- Indexed element references (`[0] <button>`)
- Long URL fragments and encoded parameters

This ensures the main agent and user only see clean, readable text.

---

## Frontend Browser Preview

The chat interface includes a live browser preview when a browser session is active:

1. Frontend calls `GET /api/sessions/:id/browser-session` to get the active browser session
2. If a session exists, the `ExtensionLiveView` component connects to the browser WebSocket
3. Screenshots are streamed at 200ms intervals
4. The preview updates in real-time as the agent navigates

---

## Configuration Reference

### Browser Service Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Browser service port |
| `PROFILES_DIR` | `/app/profiles` | Directory for browser profile storage |
| `ALLOWED_ORIGINS` | Frontend URL | CORS origins |
| `SCREENSHOT_INTERVAL_MS` | `200` | Screenshot capture frequency |
| `SCREENSHOT_QUALITY` | `60` | JPEG quality (0-100) |
| `SCREENSHOT_WIDTH` | `1920` | Browser viewport width |
| `SCREENSHOT_HEIGHT` | `1080` | Browser viewport height |
| `CAPSOLVER_API_KEY` | _(required)_ | Capsolver API key |
| `CAPSOLVER_EXTENSION_ENABLED` | `true` | Enable CAPTCHA solving |

### Extension Bridge Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_PORT` | `3001` | Internal WebSocket port |
| `BRIDGE_API_KEY` | _(empty)_ | Authentication key |
| `BACKEND_URL` | `http://backend:4000` | Backend API URL |

---

## Next Steps

- [Knowledge Base](./08-knowledge-base.md) -- Document upload, chunking, and RAG
- [Integrations](./09-integrations.md) -- Composio, Slack, Telegram, and vault connections
