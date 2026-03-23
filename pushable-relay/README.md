# Browser Agent - Chrome Extension

A production-ready Chrome Extension (Manifest V3) that acts as a browser automation agent. Connects to any WebSocket server, receives JSON commands, executes them in the real browser, and streams live screenshots back.

## Quick Test

```bash
npm install
npm run test-server
```

Then load the extension, connect to `ws://localhost:3001`, and open any webpage. The test server will send a `getPageInfo` command after 2 seconds.

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `extension` folder

## Usage

1. Click the extension icon to open the popup
2. Enter your **Server URL** (e.g. `ws://localhost:3001` or `wss://mytool.com`)
3. Enter your **API Key** (optional, sent as `?key=...` query param)
4. Click **Connect**

Credentials are saved to `chrome.storage.local` so you never have to enter them again.

## WebSocket Protocol

### Extension → Server

- `{ "type": "status", "status": "connected" | "disconnected" }`
- `{ "type": "frame", "tabId": 123, "data": "data:image/jpeg;base64,...", "tabUrl": "..." }` (every 500ms)
- `{ "type": "result", "commandId": "...", "success": true|false, "action": "...", "tabId": 123|null, "error"?: "...", "data"?: ... }`

### Server → Extension

Every command is JSON with `commandId` and `action`.

- Most actions support **`tabId`** to target a specific tab. If omitted, the extension targets the current active tab.
- The extension always responds with a result using the same `commandId` and includes the resolved `tabId` in the response.

## Supported Commands

| Action | Description |
|--------|-------------|
| `navigate` | Go to URL, wait for load |
| `click` | Click element by CSS selector |
| `type` | Type text into input |
| `typeChar` | Human-like typing, char by char |
| `scroll` | Scroll window or element |
| `waitForElement` | Wait for selector to appear |
| `waitForNavigation` | Wait for URL change |
| `getPageInfo` | Get URL, title, HTML, inputs, buttons, links |
| `screenshot` | Capture tab as JPEG |
| `keyPress` | Press Enter, Tab, Escape, etc. |
| `select` | Select dropdown option |
| `hover` | Hover over element |
| `getAttribute` | Get element attribute/property |
| `evaluate` | Run arbitrary JS in page |
| `newTab` | Open new tab (returns `{ data: { tabId } }`) |
| `closeTab` | Close tab (uses `tabId` if provided) |
| `getTabList` | List all tabs |
| `switchTab` | Switch to tab by ID (UI focus) |
| `reload` | Reload current tab |
| `setStreamingTab` | Set which tab the frame stream reports (`tabId`) |

## Features

- **Per-tab queues** — Commands execute sequentially per tab; different tabs can run in parallel
- **Auto-reconnect** — Reconnects every 3s if connection drops
- **Keepalive** — Service worker stays alive (chrome.alarms every 24s)
- **Frame stream** — Live JPEG screenshots every 500ms when connected (tagged with `tabId`)
- **Server-agnostic** — Works with any tool, LLM, or custom server
