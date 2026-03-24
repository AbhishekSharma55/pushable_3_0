/**
 * Browser Agent — Background Service Worker (v2)
 * 
 * WebSocket client with auto-reconnect, per-tab command queues running in
 * parallel, live JPEG frame streaming, and automatic tab-event broadcasting.
 *
 * PROTOCOL
 * ────────────────────────────────────────────────────────────
 * Server → Extension : { commandId, tabId, action, ...params }
 * Extension → Server : { type:"result",   commandId, tabId, success, action, data?, error? }
 * Extension → Server : { type:"frame",    tabId, url, title, data }
 * Extension → Server : { type:"tabEvent", event, tabId, url, title }
 * Extension → Server : { type:"status",   status, tabs:[{tabId,url,title}] }
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const RECONNECT_DELAY   = 3000;   // ms between reconnect attempts
const FRAME_INTERVAL    = 100;    // ms between live preview frames (~10 FPS)
const FRAME_QUALITY     = 40;     // lower JPEG quality to save bandwidth at higher FPS
const SCREENSHOT_QUALITY = 85;    // JPEG quality for on-demand screenshots
const KEEPALIVE_MINUTES  = 0.3;   // ~18 s alarm interval (must be < 30s to prevent service worker suspension)

// ─── State ───────────────────────────────────────────────────────────────────

let ws               = null;
let wsConnecting      = false;
let reconnectTimer    = null;
let frameStreamTimer  = null;
let streamingTabId    = null;   // which tab the frame stream targets
let lastConnectionError = null; // stores human-readable connection error

/**
 * Per-tab command queues.
 * Each tab executes its queue sequentially, but tabs run in parallel.
 * Map<number, { queue: object[], running: boolean }>
 */
const sessions = new Map();

function getOrCreateSession(tabId) {
  let s = sessions.get(tabId);
  if (!s) { s = { queue: [], running: false }; sessions.set(tabId, s); }
  return s;
}

function deleteSession(tabId) {
  sessions.delete(tabId);
  if (streamingTabId === tabId) streamingTabId = null;
}

// ─── Keepalive (Manifest V3 service-worker survival) ─────────────────────────

try {
  if (chrome.alarms) {
    chrome.alarms.create('keepalive', { periodInMinutes: KEEPALIVE_MINUTES });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'keepalive') {
        // Touch storage to keep service worker alive
        chrome.storage.local.get('serverUrl', (r) => {
          // Also check if we should be connected but aren't
          if (r.serverUrl && (!ws || ws.readyState !== WebSocket.OPEN) && !wsConnecting && !reconnectTimer) {
            connect();
          }
        });
      }
    });
  }
} catch (_) { /* alarms API unavailable */ }

// Fallback keepalive — setInterval to touch storage every 20s
setInterval(() => {
  chrome.storage.local.get('serverUrl', (r) => {
    // Re-establish connection if it was lost (e.g. after service worker wake)
    if (r.serverUrl && (!ws || ws.readyState !== WebSocket.OPEN) && !wsConnecting && !reconnectTimer) {
      connect();
    }
  });
}, 20000);

// ─── WebSocket ───────────────────────────────────────────────────────────────

function getWsUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['serverUrl', 'apiKey'], (r) => {
      let url = r.serverUrl || 'ws://localhost:3001';
      const key = r.apiKey || '';
      if (key) url += (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key);
      resolve(url);
    });
  });
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(msg)); } catch (_) { /* swallow */ }
  }
}

async function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  if (wsConnecting) return;
  wsConnecting = true;
  lastConnectionError = null;

  try {
    const url = await getWsUrl();
    ws = new WebSocket(url);

    ws.onopen = async () => {
      wsConnecting = false;
      stopReconnect();

      // Send full browser state on every connect
      const tabs = await chrome.tabs.query({});
      send({
        type: 'status',
        status: 'connected',
        tabs: tabs.map((t) => ({ tabId: t.id, url: t.url || '', title: t.title || '' })),
      });

      startFrameStream();
    };

    ws.onclose = (event) => {
      wsConnecting = false;
      ws = null;
      stopFrameStream();

      // If closed with a 4xxx code, it's an app-level rejection (e.g. 4001 Invalid API key)
      if (event.code >= 4000) {
        lastConnectionError = event.reason || 'Connection rejected by server';
        // Do not auto-reconnect if rejected for auth reasons
      } else if (event.code === 1000 && event.reason === 'Replaced by new connection') {
        // Server replaced us with a newer connection — don't fight it
        lastConnectionError = null;
      } else {
        // Normal disconnect or network issue — reconnect
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // If we never connected, store a generic error
      if (!lastConnectionError && ws.readyState !== WebSocket.OPEN) {
        lastConnectionError = 'WebSocket connection failed';
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        // Server heartbeat
        if (msg.type === 'ping') {
          send({ type: 'pong', ts: Date.now() });
          return;
        }

        // Command dispatch
        if (msg.commandId != null && msg.action != null) {
          enqueue(msg);
        }
      } catch (_) { /* ignore malformed messages */ }
    };
  } catch (e) {
    wsConnecting = false;
    console.error('[BrowserAgent] connect error:', e);
    scheduleReconnect();
  }
}

function disconnect() {
  stopReconnect();
  stopFrameStream();
  if (ws) { ws.close(); ws = null; }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setInterval(() => {
    chrome.storage.local.get('serverUrl', (r) => {
      if (r.serverUrl) connect();
    });
  }, RECONNECT_DELAY);
}

function stopReconnect() {
  if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = null; }
}

// ─── Tab Events — broadcast to server automatically ─────────────────────────

chrome.tabs.onCreated.addListener((tab) => {
  send({ type: 'tabEvent', event: 'created', tabId: tab.id, url: tab.pendingUrl || tab.url || '', title: tab.title || '' });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  deleteSession(tabId);
  send({ type: 'tabEvent', event: 'closed', tabId, url: '', title: '' });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    send({ type: 'tabEvent', event: 'updated', tabId, url: tab.url || '', title: tab.title || '' });
  }
});

// ─── Live Preview Frame Stream ──────────────────────────────────────────────

let isStreaming = false;

async function streamLoop() {
  if (!isStreaming) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    frameStreamTimer = setTimeout(streamLoop, FRAME_INTERVAL);
    return;
  }
  
  try {
    const tab = await getStreamingTab();
    if (!tab || !tab.id) throw new Error('No tab');
    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://'))) throw new Error('Restricted url');

    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: FRAME_QUALITY });
    send({ type: 'frame', tabId: tab.id, url: tab.url || '', title: tab.title || '', data: dataUrl });
  } catch (e) {
    // silently ignore errors
  }

  // Schedule next frame only after current one finishes
  if (isStreaming) {
    frameStreamTimer = setTimeout(streamLoop, FRAME_INTERVAL);
  }
}

function startFrameStream() {
  stopFrameStream();
  isStreaming = true;
  streamLoop();
}

function stopFrameStream() {
  isStreaming = false;
  if (frameStreamTimer) { clearTimeout(frameStreamTimer); frameStreamTimer = null; }
}

async function getStreamingTab() {
  if (streamingTabId != null) {
    try {
      const t = await chrome.tabs.get(streamingTabId);
      if (t && t.id) return t;
    } catch (_) { streamingTabId = null; }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null) streamingTabId = tab.id;
  return tab;
}

// ─── Command Queue ──────────────────────────────────────────────────────────

function enqueue(cmd) {
  resolveTabId(cmd)
    .then((tabId) => {
      if (tabId == null) {
        // Tab-free commands (getTabList, newTab) — execute immediately
        executeImmediately(cmd);
        return;
      }
      const s = getOrCreateSession(tabId);
      s.queue.push({ ...cmd, tabId });
      if (!s.running) drainQueue(tabId);
    })
    .catch((e) => {
      sendResult(cmd.commandId, cmd.action, cmd.tabId ?? null, false, undefined, String(e.message || e));
    });
}

async function drainQueue(tabId) {
  const s = getOrCreateSession(tabId);
  s.running = true;
  try {
    while (s.queue.length > 0) {
      const cmd = s.queue.shift();
      try {
        const result = await runCommand(cmd, tabId);
        sendResult(cmd.commandId, cmd.action, tabId, result.success !== false, result.data, result.error);
      } catch (e) {
        sendResult(cmd.commandId, cmd.action, tabId, false, undefined, String(e.message || e));
      }
    }
  } finally {
    s.running = false;
  }
}

async function executeImmediately(cmd) {
  try {
    const result = await runCommand(cmd, null);
    sendResult(cmd.commandId, cmd.action, result.tabId ?? null, result.success !== false, result.data, result.error);
  } catch (e) {
    sendResult(cmd.commandId, cmd.action, cmd.tabId ?? null, false, undefined, String(e.message || e));
  }
}

function sendResult(commandId, action, tabId, success, data, error) {
  const msg = { type: 'result', commandId, tabId, success, action };
  if (data !== undefined)  msg.data  = data;
  if (error !== undefined) msg.error = error;
  send(msg);
}

// ─── Tab Resolution ─────────────────────────────────────────────────────────

const TAB_FREE_ACTIONS = new Set(['getTabList', 'newTab']);

async function resolveTabId(cmd) {
  if (TAB_FREE_ACTIONS.has(cmd.action)) return null;
  if (cmd.tabId != null) return cmd.tabId;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab available');
  return tab.id;
}

// ─── Script Injection Helper ────────────────────────────────────────────────

async function waitForTabReady(tabId, maxWait = 5000) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return;
  } catch (_) { return; }
  return new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(listener); resolve(); };
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(done, maxWait);
  });
}

async function exec(tabId, func, args = []) {
  await waitForTabReady(tabId);
  try {
    const [frame] = await chrome.scripting.executeScript({ 
      target: { tabId }, 
      func, 
      args,
      world: 'MAIN' 
    });
    return frame?.result;
  } catch (e) {
    const m = e.message || '';
    if (m.includes('Cannot access') || m.includes('chrome://') || m.includes('chrome-extension://'))
      throw new Error('Cannot automate this page (restricted chrome:// or extension page)');
    throw e;
  }
}

// ─── Command Router ─────────────────────────────────────────────────────────

async function runCommand(cmd, tabId) {
  switch (cmd.action) {
    // ── Navigation ──────────────────────────────────────────────
    case 'navigate':        return cmdNavigate(tabId, cmd.url);
    case 'reload':          return cmdReload(tabId);
    case 'goBack':          return cmdGoBack(tabId);
    case 'waitForNavigation': return cmdWaitForNavigation(tabId, cmd.timeout ?? 10000);

    // ── Interaction ─────────────────────────────────────────────
    case 'click':           return execWrap(tabId, domClick,    [cmd.selector]);
    case 'clickPoint':      return execWrap(tabId, domClickPoint, [cmd.x, cmd.y]);
    case 'type':            return execWrap(tabId, domType,     [cmd.selector, cmd.text]);
    case 'typeChar':        return execWrap(tabId, domTypeChar, [cmd.selector, cmd.text, cmd.delay ?? 80]);
    case 'keyPress':        return cmdKeyPress(tabId, cmd.key);
    case 'select':          return execWrap(tabId, domSelect,   [cmd.selector, cmd.value]);
    case 'hover':           return execWrap(tabId, domHover,    [cmd.selector]);
    case 'scroll':          return execWrap(tabId, domScroll,   [cmd.selector, cmd.x ?? 0, cmd.y ?? 0]);

    // ── Queries ─────────────────────────────────────────────────
    case 'getPageInfo':     return execWrap(tabId, domGetPageInfo, []);
    case 'getElements':     return execWrap(tabId, domGetElements, []);
    case 'getAttribute':    return execWrap(tabId, domGetAttribute, [cmd.selector, cmd.attribute]);
    case 'waitForElement':  return execWrap(tabId, domWaitForElement, [cmd.selector, cmd.timeout ?? 10000]);
    case 'evaluate':        return cmdEvaluate(tabId, cmd.script);

    // ── Screenshot ──────────────────────────────────────────────
    case 'screenshot':      return cmdScreenshot(tabId);

    // ── Tab Management ──────────────────────────────────────────
    case 'newTab':          return cmdNewTab(cmd.url, cmd.active);
    case 'closeTab':        return cmdCloseTab(tabId);
    case 'switchTab':       return cmdSwitchTab(cmd.tabId ?? tabId);
    case 'getTabList':      return cmdGetTabList();
    case 'setStreamingTab': { streamingTabId = cmd.tabId ?? null; return { success: true, data: { tabId: streamingTabId } }; }

    default:
      return { success: false, error: 'Unknown action: ' + cmd.action };
  }
}

/** Wrap exec() results into standard {success,data,error} */
async function execWrap(tabId, func, args) {
  const r = await exec(tabId, func, args);
  if (r && r.success === false) return r;            // explicit failure from DOM fn
  if (r && r.success === true)  return r;             // explicit success
  if (r !== undefined)          return { success: true, data: r };
  return { success: true };
}

// ─── Browser Commands ─────────────────────────────────────────────────────────

function formatUrl(url) {
  if (!url) return url;
  if (/^(https?|file|chrome|about|data):/i.test(url)) return url;
  return `http://${url}`;
}

// ─── Navigation Commands ────────────────────────────────────────────────────

async function cmdNavigate(tabId, url) {
  const formattedUrl = formatUrl(url);
  await chrome.tabs.update(tabId, { url: formattedUrl });
  return cmdWaitForNavigation(tabId, 15000);
}

async function cmdReload(tabId) {
  await chrome.tabs.reload(tabId);
  return new Promise((resolve) => {
    const timeout = 15000;
    const done = () => { chrome.tabs.onUpdated.removeListener(listener); resolve({ success: true }); };
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(done, timeout);
  });
}

async function cmdGoBack(tabId) {
  try { await chrome.tabs.goBack(tabId); return { success: true }; }
  catch (e) { return { success: false, error: String(e.message || e) }; }
}

async function cmdWaitForNavigation(tabId, timeout) {
  const tab = await chrome.tabs.get(tabId);
  const startUrl = tab.url || '';
  return new Promise((resolve) => {
    const done = (ok) => { chrome.tabs.onUpdated.removeListener(listener); resolve({ success: ok }); };
    const listener = async (id, info) => {
      if (id !== tabId) return;
      if (info.status === 'complete') {
        try {
          const t = await chrome.tabs.get(tabId);
          if (t.url && t.url !== startUrl) done(true);
        } catch (_) {}
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => done(true), timeout);
  });
}

// ─── Tab Commands ───────────────────────────────────────────────────────────

async function cmdNewTab(url, active = true) {
  const opts = { active: active !== false };
  const formattedUrl = url && url !== 'about:blank' ? formatUrl(url) : url;
  if (formattedUrl) opts.url = formattedUrl;
  const tab = await chrome.tabs.create(opts);
  return new Promise((resolve) => {
    const timeout = 15000;
    // If no url or about:blank, resolve immediately
    if (!url || url === 'about:blank') {
      resolve({ success: true, data: { newTabId: tab.id }, tabId: tab.id });
      return;
    }
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve({ success: true, data: { newTabId: tab.id }, tabId: tab.id });
    };
    const listener = (id, info) => { if (id === tab.id && info.status === 'complete') done(); };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(done, timeout);
  });
}

async function cmdCloseTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
    deleteSession(tabId);
    return { success: true, tabId };
  } catch (e) {
    return { success: false, tabId, error: String(e.message || e) };
  }
}

async function cmdSwitchTab(tabId) {
  try {
    await chrome.tabs.update(tabId, { active: true });
    return { success: true, tabId };
  } catch (e) {
    return { success: false, tabId, error: String(e.message || e) };
  }
}

async function cmdGetTabList() {
  const tabs = await chrome.tabs.query({});
  return {
    success: true,
    data: tabs.map((t) => ({ tabId: t.id, url: t.url || '', title: t.title || '', active: t.active })),
  };
}

// ─── Screenshot ─────────────────────────────────────────────────────────────

async function cmdScreenshot(tabId) {
  // Ensure the tab is the visible tab in its window
  try {
    const tab = await chrome.tabs.get(tabId);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: SCREENSHOT_QUALITY });
    return { success: true, tabId, data: dataUrl };
  } catch (e) {
    return { success: false, tabId, error: String(e.message || e) };
  }
}

// ─── Evaluate ───────────────────────────────────────────────────────────────

async function cmdEvaluate(tabId, script) {
  try {
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (s) => {
        try { return { success: true, data: eval(s) }; }
        catch (e) { return { success: false, error: String(e.message || e) }; }
      },
      args: [script],
    });
    return frame?.result ?? { success: false, error: 'No result' };
  } catch (e) {
    return { success: false, error: String(e.message || e) };
  }
}

// ─── Key Press via Debugger API (sends trusted events) ──────────────────────

const KEY_DEFINITIONS = {
  Enter:      { key: 'Enter',      code: 'Enter',      keyCode: 13, windowsVirtualKeyCode: 13 },
  Tab:        { key: 'Tab',        code: 'Tab',        keyCode: 9,  windowsVirtualKeyCode: 9 },
  Escape:     { key: 'Escape',     code: 'Escape',     keyCode: 27, windowsVirtualKeyCode: 27 },
  Backspace:  { key: 'Backspace',  code: 'Backspace',  keyCode: 8,  windowsVirtualKeyCode: 8 },
  Delete:     { key: 'Delete',     code: 'Delete',     keyCode: 46, windowsVirtualKeyCode: 46 },
  Space:      { key: ' ',          code: 'Space',      keyCode: 32, windowsVirtualKeyCode: 32 },
  ArrowDown:  { key: 'ArrowDown',  code: 'ArrowDown',  keyCode: 40, windowsVirtualKeyCode: 40 },
  ArrowUp:    { key: 'ArrowUp',    code: 'ArrowUp',    keyCode: 38, windowsVirtualKeyCode: 38 },
  ArrowLeft:  { key: 'ArrowLeft',  code: 'ArrowLeft',  keyCode: 37, windowsVirtualKeyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, windowsVirtualKeyCode: 39 },
};

async function cmdKeyPress(tabId, key) {
  const def = KEY_DEFINITIONS[key] || { key: key, code: key, keyCode: 0, windowsVirtualKeyCode: 0 };

  try {
    // Attach debugger to the tab
    await chrome.debugger.attach({ tabId }, '1.3');

    // Send keyDown event (trusted — sites like YouTube, Google, Facebook treat these as real)
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: def.key,
      code: def.code,
      windowsVirtualKeyCode: def.windowsVirtualKeyCode,
      nativeVirtualKeyCode: def.windowsVirtualKeyCode,
    });

    // Small delay between down and up
    await new Promise((r) => setTimeout(r, 50));

    // Send keyUp event
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: def.key,
      code: def.code,
      windowsVirtualKeyCode: def.windowsVirtualKeyCode,
      nativeVirtualKeyCode: def.windowsVirtualKeyCode,
    });

    // Detach debugger
    await chrome.debugger.detach({ tabId });

    return { success: true };
  } catch (e) {
    // Detach debugger on error
    try { await chrome.debugger.detach({ tabId }); } catch (_) {}

    // Fallback: use DOM-level events if debugger fails (e.g., chrome:// pages)
    try {
      return await execWrap(tabId, domKeyPress, [key]);
    } catch (_) {
      return { success: false, error: String(e.message || e) };
    }
  }
}

// ─── DOM Functions (injected into page via chrome.scripting.executeScript) ───

function domClick(selector) {
  const el = document.querySelector(selector);
  if (!el) return { success: false, error: 'Element not found: ' + selector };
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Simulate full mouse event sequence for framework compatibility
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };

  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.focus();
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));

  return new Promise((r) => setTimeout(() => r({ success: true }), 300));
}

function domClickPoint(px, py) {
  const x = Math.round(px * window.innerWidth);
  const y = Math.round(py * window.innerHeight);
  const el = document.elementFromPoint(x, y);
  if (!el) return { success: false, error: 'No element found at ' + x + ',' + y };
  
  el.focus();
  try { el.click(); } catch(e) {}
  
  const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
  try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch(e) {}
  try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch(e) {}
  try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch(e) {}
  try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch(e) {}
  try { el.dispatchEvent(new MouseEvent('click', opts)); } catch(e) {}
  
  return new Promise((r) => setTimeout(() => r({ success: true, data: { x, y, tag: el.tagName } }), 300));
}

function domType(selector, text) {
  const el = document.querySelector(selector);
  if (!el) return { success: false, error: 'Element not found: ' + selector };
  el.focus();
  el.click();

  // Reset React/Vue internal value tracker so frameworks detect the change
  const tracker = el._valueTracker;
  if (tracker) tracker.setValue('');

  // Use native setter to bypass framework interception (handle both input and textarea)
  const proto = Object.getPrototypeOf(el);
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (nativeSetter) {
    nativeSetter.call(el, text);
  } else {
    el.value = text;
  }

  // Fire InputEvent (not generic Event) — React and modern frameworks listen for this
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return new Promise((r) => setTimeout(() => r({ success: true }), 150));
}

function domTypeChar(selector, text, delay) {
  const el = document.querySelector(selector);
  if (!el) return { success: false, error: 'Element not found: ' + selector };
  el.focus();
  el.click();

  // Reset React/Vue internal value tracker
  const tracker = el._valueTracker;
  if (tracker) tracker.setValue('');

  // Get native setter for framework compatibility
  const nativeSetter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(el), 'value'
  )?.set || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

  if (nativeSetter) { nativeSetter.call(el, ''); } else { el.value = ''; }

  return new Promise((resolve) => {
    let i = 0;
    function next() {
      if (i >= text.length) { setTimeout(() => resolve({ success: true }), 100); return; }
      const c = text[i++];
      const newVal = text.substring(0, i);

      // Reset tracker before each character so React detects each change
      const t = el._valueTracker;
      if (t) t.setValue(text.substring(0, i - 1));

      if (nativeSetter) { nativeSetter.call(el, newVal); } else { el.value = newVal; }

      el.dispatchEvent(new KeyboardEvent('keydown', { key: c, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keypress', { key: c, bubbles: true }));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: c }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: c, bubbles: true }));
      setTimeout(next, delay);
    }
    next();
  });
}

function domKeyPress(key) {
  const el = document.activeElement || document.body;
  const keyMap = {
    Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
    Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
    Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
    ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
    ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
    Space: { key: ' ', code: 'Space', keyCode: 32 },
    Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  };
  const mapped = keyMap[key] || { key: key, code: key, keyCode: 0 };
  const opts = { key: mapped.key, code: mapped.code, keyCode: mapped.keyCode, which: mapped.keyCode, bubbles: true, cancelable: true };

  el.dispatchEvent(new KeyboardEvent('keydown', opts));
  el.dispatchEvent(new KeyboardEvent('keypress', opts));
  el.dispatchEvent(new KeyboardEvent('keyup', opts));

  // For Enter: also submit the parent form if inside one
  if (key === 'Enter') {
    const form = el.closest('form');
    if (form) {
      const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
      if (submitBtn) { submitBtn.click(); }
      else { form.requestSubmit ? form.requestSubmit() : form.submit(); }
    }
  }

  return { success: true };
}

function domSelect(selector, value) {
  const el = document.querySelector(selector);
  if (!el) return { success: false, error: 'Element not found: ' + selector };

  // Reset React tracker
  const tracker = el._valueTracker;
  if (tracker) tracker.setValue('');

  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (nativeSetter) { nativeSetter.call(el, value); } else { el.value = value; }

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { success: true };
}

function domHover(selector) {
  const el = document.querySelector(selector);
  if (!el) return { success: false, error: 'Element not found: ' + selector };
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const rect = el.getBoundingClientRect();
  const opts = { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  el.dispatchEvent(new PointerEvent('pointerover', opts));
  el.dispatchEvent(new MouseEvent('mouseover', opts));
  el.dispatchEvent(new PointerEvent('pointerenter', { ...opts, bubbles: false }));
  el.dispatchEvent(new MouseEvent('mouseenter', { ...opts, bubbles: false }));
  el.dispatchEvent(new MouseEvent('mousemove', opts));
  return new Promise((r) => setTimeout(() => r({ success: true }), 200));
}

function domScroll(selector, x, y) {
  if (selector) {
    const el = document.querySelector(selector);
    if (!el) return { success: false, error: 'Element not found: ' + selector };
    el.scrollBy(x, y);
  } else {
    window.scrollBy(x, y);
  }
  return { success: true };
}

function domWaitForElement(selector, timeout) {
  const start = Date.now();
  return new Promise((resolve) => {
    (function check() {
      if (document.querySelector(selector)) return resolve({ success: true });
      if (Date.now() - start >= timeout) return resolve({ success: false, error: 'Timeout waiting for: ' + selector });
      setTimeout(check, 300);
    })();
  });
}

function domGetPageInfo() {
  const body = document.body;
  if (!body) return { success: false, error: 'No document body' };

  function sel(el) {
    // Try unique selectors first
    if (el.id) return '#' + CSS.escape(el.id);
    if (el.getAttribute('data-testid')) return '[data-testid="' + CSS.escape(el.getAttribute('data-testid')) + '"]';
    if (el.getAttribute('aria-label')) return '[aria-label="' + CSS.escape(el.getAttribute('aria-label')) + '"]';
    if (el.name) {
      const s = el.tagName.toLowerCase() + '[name="' + CSS.escape(el.name) + '"]';
      if (document.querySelectorAll(s).length === 1) return s;
    }
    if (el.placeholder) {
      const s = el.tagName.toLowerCase() + '[placeholder="' + CSS.escape(el.placeholder) + '"]';
      if (document.querySelectorAll(s).length === 1) return s;
    }
    if (el.className && typeof el.className === 'string') {
      const cls = el.className.trim().split(/\s+/).slice(0, 2).map((c) => '.' + CSS.escape(c)).join('');
      const s = el.tagName.toLowerCase() + cls;
      if (document.querySelectorAll(s).length === 1) return s;
    }
    // Fallback: nth-of-type for uniqueness
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(el) + 1;
        return el.tagName.toLowerCase() + ':nth-of-type(' + idx + ')';
      }
    }
    return el.tagName.toLowerCase();
  }

  const html   = (body.innerHTML || '').substring(0, 8000);
  const text   = (body.innerText || '').substring(0, 3000);
  const inputs = Array.from(body.querySelectorAll('input, textarea, select')).slice(0, 30).map((el) => ({
    selector: sel(el),
    type: el.type || el.tagName.toLowerCase(),
    placeholder: (el.placeholder || '').substring(0, 100),
    value: (el.value || '').substring(0, 500),
  }));
  const buttons = Array.from(body.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]')).slice(0, 30).map((el) => ({
    selector: sel(el),
    text: (el.textContent || el.value || '').trim().substring(0, 100),
  }));
  const links = Array.from(body.querySelectorAll('a[href]')).slice(0, 50).map((a) => ({
    href: a.href,
    text: (a.textContent || '').trim().substring(0, 100),
    selector: sel(a),
  }));

  return {
    success: true,
    data: { url: location.href, title: document.title || '', html, text, inputs, buttons, links },
  };
}

function domGetElements() {
  const body = document.body;
  if (!body) return { success: false, error: 'No document body' };

  function sel(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    if (el.getAttribute('data-testid')) return '[data-testid="' + CSS.escape(el.getAttribute('data-testid')) + '"]';
    if (el.getAttribute('aria-label')) return '[aria-label="' + CSS.escape(el.getAttribute('aria-label')) + '"]';
    if (el.name) {
      const s = el.tagName.toLowerCase() + '[name="' + CSS.escape(el.name) + '"]';
      if (document.querySelectorAll(s).length === 1) return s;
    }
    if (el.placeholder) {
      const s = el.tagName.toLowerCase() + '[placeholder="' + CSS.escape(el.placeholder) + '"]';
      if (document.querySelectorAll(s).length === 1) return s;
    }
    if (el.className && typeof el.className === 'string') {
      const cls = el.className.trim().split(/\s+/).slice(0, 2).map((c) => '.' + CSS.escape(c)).join('');
      const s = el.tagName.toLowerCase() + cls;
      if (document.querySelectorAll(s).length === 1) return s;
    }
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(el) + 1;
        return el.tagName.toLowerCase() + ':nth-of-type(' + idx + ')';
      }
    }
    return el.tagName.toLowerCase();
  }

  const inputs = Array.from(body.querySelectorAll('input, textarea, select, [contenteditable="true"]')).slice(0, 30).map((el) => ({
    tag: el.tagName.toLowerCase(),
    selector: sel(el),
    type: el.type || el.tagName.toLowerCase(),
    placeholder: (el.placeholder || '').substring(0, 100),
    value: (el.value || '').substring(0, 200),
    label: el.labels?.[0]?.textContent?.trim()?.substring(0, 100) || '',
    visible: el.offsetParent !== null,
  }));

  const clickables = Array.from(body.querySelectorAll('button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], input[type="submit"], input[type="button"]')).slice(0, 50).map((el) => ({
    tag: el.tagName.toLowerCase(),
    selector: sel(el),
    text: (el.textContent || el.value || '').trim().substring(0, 120),
    href: el.href || null,
    visible: el.offsetParent !== null,
  }));

  return {
    success: true,
    data: {
      url: location.href,
      title: document.title || '',
      inputs: inputs.filter((i) => i.visible),
      clickables: clickables.filter((c) => c.visible),
    },
  };
}

function domGetAttribute(selector, attribute) {
  const el = document.querySelector(selector);
  if (!el) return { success: false, error: 'Element not found: ' + selector };
  const val = el.getAttribute(attribute) ?? el[attribute] ?? null;
  return { success: true, data: val };
}

// ─── Message Listener (popup ↔ background) ──────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'connect') {
    connect();
    sendResponse({ ok: true });
  } else if (msg.action === 'disconnect') {
    disconnect();
    sendResponse({ ok: true });
  } else if (msg.action === 'getStatus') {
    let status = 'disconnected';
    if (ws && ws.readyState === WebSocket.OPEN) status = 'connected';
    else if (wsConnecting || reconnectTimer) status = 'connecting';
    else if (lastConnectionError) status = 'error';

    chrome.tabs.query({}).then((tabs) => {
      sendResponse({ status, tabCount: tabs.length, error: lastConnectionError });
    });
    return true; // async response
  } else if (msg.action === 'getStreamingTab') {
    getStreamingTab().then((t) => sendResponse({ tabId: t?.id ?? null, url: t?.url || '' }));
    return true;
  }
  return true;
});
