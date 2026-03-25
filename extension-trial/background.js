/**
 * background.js — Browser Agent v3 service worker
 *
 * Protocol-compatible with pushable-relay — works with existing extension-bridge
 * without any backend changes.
 *
 * Improvements over v2:
 * 1. CDP trusted mouse click (Input.dispatchMouseEvent) for anti-bot sites
 * 2. DOM settlement after every interaction via content script MutationObserver
 * 3. Content-script-based DOM ops (no per-command executeScript injection)
 * 4. Auto content script re-injection after navigation
 */

/* ── Constants ── */
const RECONNECT_DELAY = 3000;
const FRAME_INTERVAL = 100;     // ~10 FPS
const FRAME_QUALITY = 40;
const SCREENSHOT_QUALITY = 85;
const KEEPALIVE_MINUTES = 0.3;  // ~18 seconds
const PAGE_LOAD_TIMEOUT = 15000;
const ELEMENT_WAIT_TIMEOUT = 10000;
const DOM_SETTLE_QUIET = 400;
const DOM_SETTLE_MAX = 5000;

/* ── State ── */
let ws = null;
let status = 'disconnected'; // disconnected | connecting | connected | error
let lastError = '';
let userDisconnected = false;
let streamingTabId = null;

// Per-tab command queues (parallel across tabs, sequential per tab)
const sessions = new Map();

/* ── Keepalive (prevent MV3 service worker suspension) ── */
chrome.alarms.create('keepalive', { periodInMinutes: KEEPALIVE_MINUTES });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    if (!userDisconnected && status === 'disconnected') {
      connect();
    }
  }
});
// Fallback keepalive
setInterval(() => {
  if (!userDisconnected && status === 'disconnected') connect();
}, 20000);

/* ── WebSocket URL ── */
async function getWsUrl() {
  const data = await chrome.storage.local.get(['serverUrl', 'apiKey']);
  const url = data.serverUrl;
  if (!url) return null;
  const key = data.apiKey || '';
  return key ? `${url}?key=${encodeURIComponent(key)}` : url;
}

/* ── Send to WebSocket ── */
function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

/* ── Connect to extension bridge ── */
async function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const url = await getWsUrl();
  if (!url) {
    status = 'error';
    lastError = 'No server URL configured';
    return;
  }

  status = 'connecting';
  lastError = '';
  userDisconnected = false;

  try {
    ws = new WebSocket(url);
  } catch (err) {
    status = 'error';
    lastError = err.message;
    return;
  }

  ws.onopen = async () => {
    status = 'connected';
    lastError = '';
    console.log('[BrowserAgent v3] Connected to bridge');

    // Send initial status with all open tabs
    const tabs = await chrome.tabs.query({});
    send({
      type: 'status',
      status: 'connected',
      tabs: tabs.map(t => ({ tabId: t.id, url: t.url, title: t.title }))
    });

    // Start frame streaming
    startFrameLoop();
  };

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch { return; }

    // Server heartbeat
    if (msg.type === 'ping') {
      send({ type: 'pong' });
      return;
    }

    // Command from backend
    if (msg.commandId && msg.action) {
      enqueue(msg);
    }
  };

  ws.onclose = (event) => {
    ws = null;
    stopFrameLoop();

    // 4xxx = permanent auth failure
    if (event.code >= 4000 && event.code < 5000) {
      status = 'error';
      lastError = event.reason || `Auth failed (${event.code})`;
      return;
    }

    if (event.reason === 'Replaced by new connection') {
      status = 'disconnected';
      return;
    }

    status = 'disconnected';
    if (!userDisconnected) {
      setTimeout(connect, RECONNECT_DELAY);
    }
  };

  ws.onerror = () => {
    status = 'error';
    lastError = 'WebSocket error';
  };
}

/* ── Disconnect ── */
function disconnect() {
  userDisconnected = true;
  if (ws) {
    ws.close(1000, 'User disconnected');
    ws = null;
  }
  status = 'disconnected';
  lastError = '';
  stopFrameLoop();
}

/* ── Tab event broadcasting ── */
chrome.tabs.onCreated.addListener((tab) => {
  send({ type: 'tabEvent', event: 'created', tabId: tab.id, url: tab.url || '', title: tab.title || '' });
});
chrome.tabs.onRemoved.addListener((tabId) => {
  sessions.delete(tabId);
  send({ type: 'tabEvent', event: 'closed', tabId });
});
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.title) {
    send({ type: 'tabEvent', event: 'updated', tabId, url: tab.url, title: tab.title });
  }
});

/* ── Frame streaming ── */
let frameTimer = null;

function startFrameLoop() {
  stopFrameLoop();
  frameTimer = setInterval(captureFrame, FRAME_INTERVAL);
}

function stopFrameLoop() {
  if (frameTimer) {
    clearInterval(frameTimer);
    frameTimer = null;
  }
}

async function captureFrame() {
  try {
    const tab = await getStreamingTab();
    if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: FRAME_QUALITY });
    send({ type: 'frame', tabId: tab.id, url: tab.url, title: tab.title, data: dataUrl });
  } catch { /* ignore capture errors */ }
}

async function getStreamingTab() {
  if (streamingTabId) {
    try {
      return await chrome.tabs.get(streamingTabId);
    } catch {
      streamingTabId = null;
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/* ── Command queue (per-tab sequential, cross-tab parallel) ── */
function enqueue(cmd) {
  const tabFree = ['getTabList', 'newTab'];
  if (tabFree.includes(cmd.action)) {
    executeCommand(cmd, null);
    return;
  }

  const tabId = cmd.tabId;
  if (!tabId) {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab) {
        cmd.tabId = tab.id;
        enqueueForTab(cmd);
      } else {
        sendResult(cmd, false, null, 'No active tab');
      }
    });
    return;
  }
  enqueueForTab(cmd);
}

function enqueueForTab(cmd) {
  const tabId = cmd.tabId;
  if (!sessions.has(tabId)) {
    sessions.set(tabId, { queue: [], running: false });
  }
  const session = sessions.get(tabId);
  session.queue.push(cmd);
  drainQueue(tabId);
}

async function drainQueue(tabId) {
  const session = sessions.get(tabId);
  if (!session || session.running) return;
  session.running = true;
  while (session.queue.length > 0) {
    const cmd = session.queue.shift();
    await executeCommand(cmd, tabId);
  }
  session.running = false;
}

function sendResult(cmd, success, data, error) {
  send({
    type: 'result',
    commandId: cmd.commandId,
    tabId: cmd.tabId || null,
    success,
    action: cmd.action,
    ...(success ? { data } : { error: error || 'Unknown error' })
  });
}

/* ── Ensure content script is available ── */
async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    return true;
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await new Promise(r => setTimeout(r, 200));
      return true;
    } catch {
      return false;
    }
  }
}

/* ── Send message to content script ── */
function sendToContent(tabId, msg) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, (res) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(res);
      }
    });
  });
}

/* ── Wait for page load ── */
function waitForPageLoad(tabId, timeout = PAGE_LOAD_TIMEOUT) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.webNavigation.onCompleted.removeListener(listener);
      resolve();
    }, timeout);

    function listener(details) {
      if (details.tabId === tabId && details.frameId === 0) {
        clearTimeout(timer);
        chrome.webNavigation.onCompleted.removeListener(listener);
        setTimeout(resolve, 500);
      }
    }
    chrome.webNavigation.onCompleted.addListener(listener);
  });
}

/* ── Wait for URL change ── */
function waitForNavigation(tabId, timeout = 10000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve({ ok: false, error: 'Navigation timeout' });
    }, timeout);

    function listener(id, info) {
      if (id === tabId && info.url) {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(() => resolve({ ok: true, url: info.url }), 500);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/* ── DOM settlement wait ── */
async function settleDOM(tabId) {
  try {
    await sendToContent(tabId, { action: 'waitForDOM', quietMs: DOM_SETTLE_QUIET, maxMs: DOM_SETTLE_MAX });
  } catch {
    // Content script may be gone (navigation) — wait a fixed time
    await new Promise(r => setTimeout(r, 800));
    await ensureContentScript(tabId);
  }
}

/* ══════════════════════════════════════════════════════════════
 *  CDP TRUSTED EVENTS — Chrome Debugger API
 *  These produce isTrusted=true events that bypass anti-bot checks.
 * ══════════════════════════════════════════════════════════════ */

/** Send trusted keyboard event via CDP */
function debuggerKeyPress(tabId, key) {
  const keyMap = {
    Enter:      { key: 'Enter',      code: 'Enter',      keyCode: 13, text: '\r' },
    Tab:        { key: 'Tab',        code: 'Tab',        keyCode: 9,  text: '' },
    Escape:     { key: 'Escape',     code: 'Escape',     keyCode: 27, text: '' },
    Backspace:  { key: 'Backspace',  code: 'Backspace',  keyCode: 8,  text: '' },
    Delete:     { key: 'Delete',     code: 'Delete',     keyCode: 46, text: '' },
    Space:      { key: ' ',          code: 'Space',      keyCode: 32, text: ' ' },
    ArrowUp:    { key: 'ArrowUp',    code: 'ArrowUp',    keyCode: 38, text: '' },
    ArrowDown:  { key: 'ArrowDown',  code: 'ArrowDown',  keyCode: 40, text: '' },
    ArrowLeft:  { key: 'ArrowLeft',  code: 'ArrowLeft',  keyCode: 37, text: '' },
    ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, text: '' },
  };
  const mapped = keyMap[key] || { key, code: key, keyCode: 0, text: key.length === 1 ? key : '' };

  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }

      const params = {
        type: 'keyDown',
        key: mapped.key,
        code: mapped.code,
        windowsVirtualKeyCode: mapped.keyCode,
        nativeVirtualKeyCode: mapped.keyCode,
        text: mapped.text
      };

      chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', params, () => {
        const upParams = { ...params, type: 'keyUp', text: '' };
        chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', upParams, () => {
          chrome.debugger.detach({ tabId }, () => resolve());
        });
      });
    });
  });
}

/**
 * Send trusted mouse click via CDP — for sites that check event.isTrusted.
 * Uses element coordinates from content script getBoundingClientRect.
 */
function debuggerMouseClick(tabId, x, y) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }

      const downParams = {
        type: 'mousePressed',
        x, y,
        button: 'left',
        clickCount: 1
      };

      chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', downParams, () => {
        if (chrome.runtime.lastError) {
          chrome.debugger.detach({ tabId }, () => reject(new Error(chrome.runtime.lastError?.message || 'mousePressed failed')));
          return;
        }

        const upParams = {
          type: 'mouseReleased',
          x, y,
          button: 'left',
          clickCount: 1
        };

        chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', upParams, () => {
          chrome.debugger.detach({ tabId }, () => resolve());
        });
      });
    });
  });
}

/**
 * Get element center coordinates for CDP mouse click.
 * First scrolls element into view, then gets viewport coords.
 * Supports deep shadow DOM queries.
 */
async function getElementCoords(tabId, selector) {
  try {
    // Try via content script first (supports shadow DOM + element map)
    const csResult = await sendToContent(tabId, { action: 'getCoords', selector });
    if (csResult && csResult.x !== undefined) return csResult;
  } catch {}

  // Fallback: direct executeScript
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      },
      args: [selector],
      world: 'MAIN'
    });
    return result;
  } catch {
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════
 *  COMMAND EXECUTION
 * ══════════════════════════════════════════════════════════════ */

async function executeCommand(cmd, tabId) {
  try {
    // Restrict chrome:// pages
    if (tabId) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://'))) {
          if (!['navigate', 'newTab', 'getTabList', 'switchTab', 'closeTab', 'screenshot'].includes(cmd.action)) {
            sendResult(cmd, false, null, 'Cannot interact with chrome:// pages');
            return;
          }
        }
      } catch {
        sendResult(cmd, false, null, `Tab ${tabId} not found`);
        return;
      }
    }

    switch (cmd.action) {

      /* ── Navigation ── */
      case 'navigate': {
        let url = cmd.url;
        if (url && !url.startsWith('http') && !url.startsWith('file:')) {
          url = 'https://' + url;
        }
        await chrome.tabs.update(tabId, { url });
        await waitForPageLoad(tabId);
        await ensureContentScript(tabId);
        const tab = await chrome.tabs.get(tabId);
        sendResult(cmd, true, { url: tab.url, title: tab.title });
        break;
      }

      case 'reload': {
        await chrome.tabs.reload(tabId);
        await waitForPageLoad(tabId);
        await ensureContentScript(tabId);
        sendResult(cmd, true, {});
        break;
      }

      case 'goBack': {
        await ensureContentScript(tabId);
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => { history.back(); }
        });
        await waitForPageLoad(tabId).catch(() => {});
        await ensureContentScript(tabId);
        sendResult(cmd, true, {});
        break;
      }

      case 'waitForNavigation': {
        const navResult = await waitForNavigation(tabId, cmd.timeout || 10000);
        sendResult(cmd, navResult.ok !== false, navResult);
        break;
      }

      /* ── Interaction (via content script) ── */
      case 'click': {
        await ensureContentScript(tabId);
        const result = await sendToContent(tabId, { action: 'click', selector: cmd.selector });
        if (!result.ok) {
          sendResult(cmd, false, null, result.error);
        } else {
          await settleDOM(tabId);
          sendResult(cmd, true, result);
        }
        break;
      }

      case 'clickPoint': {
        await ensureContentScript(tabId);
        const result = await sendToContent(tabId, { action: 'clickPoint', x: cmd.x, y: cmd.y });
        if (!result.ok) {
          sendResult(cmd, false, null, result.error);
        } else {
          await settleDOM(tabId);
          sendResult(cmd, true, result);
        }
        break;
      }

      case 'type': {
        await ensureContentScript(tabId);
        const result = await sendToContent(tabId, { action: 'type', selector: cmd.selector, text: cmd.text });
        if (!result.ok) {
          sendResult(cmd, false, null, result.error);
        } else {
          await settleDOM(tabId);
          sendResult(cmd, true, result);
        }
        break;
      }

      case 'typeChar': {
        await ensureContentScript(tabId);
        const result = await sendToContent(tabId, {
          action: 'typeChar',
          selector: cmd.selector,
          text: cmd.text,
          delay: cmd.delay || 80
        });
        if (!result.ok) {
          sendResult(cmd, false, null, result.error);
        } else {
          await settleDOM(tabId);
          sendResult(cmd, true, result);
        }
        break;
      }

      case 'keyPress': {
        // CDP trusted events first
        try {
          await debuggerKeyPress(tabId, cmd.key);
          await settleDOM(tabId);
          sendResult(cmd, true, {});
        } catch {
          // Fallback to content script
          await ensureContentScript(tabId);
          const result = await sendToContent(tabId, { action: 'keyPress', key: cmd.key });
          await settleDOM(tabId);
          sendResult(cmd, result.ok !== false, result);
        }
        break;
      }

      case 'select': {
        await ensureContentScript(tabId);
        const result = await sendToContent(tabId, { action: 'select', selector: cmd.selector, value: cmd.value });
        await settleDOM(tabId);
        sendResult(cmd, result.ok !== false, result, result.error);
        break;
      }

      case 'hover': {
        await ensureContentScript(tabId);
        const result = await sendToContent(tabId, { action: 'hover', selector: cmd.selector });
        sendResult(cmd, result.ok !== false, result, result.error);
        break;
      }

      case 'scroll': {
        await ensureContentScript(tabId);
        const result = await sendToContent(tabId, {
          action: 'scroll',
          selector: cmd.selector || null,
          x: cmd.x || 0,
          y: cmd.y || 0
        });
        sendResult(cmd, result.ok !== false, result, result.error);
        break;
      }

      /* ── Query ── */
      case 'getPageInfo': {
        await ensureContentScript(tabId);
        const data = await sendToContent(tabId, { action: 'getPageInfo' });
        sendResult(cmd, true, data);
        break;
      }

      case 'getElements': {
        await ensureContentScript(tabId);
        const data = await sendToContent(tabId, { action: 'getElements' });
        sendResult(cmd, true, data);
        break;
      }

      case 'getAttribute': {
        await ensureContentScript(tabId);
        const result = await sendToContent(tabId, { action: 'getAttribute', selector: cmd.selector, attribute: cmd.attribute });
        sendResult(cmd, result.ok !== false, result, result.error);
        break;
      }

      case 'waitForElement': {
        await ensureContentScript(tabId);
        const result = await sendToContent(tabId, { action: 'waitForElement', selector: cmd.selector, timeout: cmd.timeout || ELEMENT_WAIT_TIMEOUT });
        sendResult(cmd, result.ok !== false, result, result.error);
        break;
      }

      case 'evaluate': {
        try {
          // Try MAIN world first (has access to page JS context)
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId },
            func: (script) => {
              try { return { ok: true, value: eval(script) }; }
              catch (e) { return { ok: false, error: e.message }; }
            },
            args: [cmd.script],
            world: 'MAIN'
          });
          if (result.ok) {
            sendResult(cmd, true, result);
          } else if (result.error && result.error.includes('Content Security Policy')) {
            // CSP blocks eval in MAIN world — try Function constructor approach
            try {
              const [{ result: r2 }] = await chrome.scripting.executeScript({
                target: { tabId },
                func: (script) => {
                  try { return { ok: true, value: new Function(script)() }; }
                  catch (e) { return { ok: false, error: e.message }; }
                },
                args: [cmd.script],
                world: 'MAIN'
              });
              sendResult(cmd, r2.ok, r2.ok ? r2 : null, r2.error);
            } catch (e2) {
              sendResult(cmd, false, null, result.error);
            }
          } else {
            sendResult(cmd, false, null, result.error);
          }
        } catch (err) {
          sendResult(cmd, false, null, err.message);
        }
        break;
      }

      /* ── Screenshot ── */
      case 'screenshot': {
        try {
          const tab = await chrome.tabs.get(tabId);
          const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: SCREENSHOT_QUALITY });
          sendResult(cmd, true, { screenshot: dataUrl, url: tab.url, title: tab.title });
        } catch (err) {
          sendResult(cmd, false, null, err.message);
        }
        break;
      }

      /* ── Tab management ── */
      case 'newTab': {
        const newTab = await chrome.tabs.create({
          url: cmd.url || 'about:blank',
          active: cmd.active !== false
        });
        if (cmd.url && cmd.url !== 'about:blank') {
          await waitForPageLoad(newTab.id);
          await ensureContentScript(newTab.id);
        }
        sendResult(cmd, true, { newTabId: newTab.id, url: newTab.url, title: newTab.title });
        break;
      }

      case 'closeTab': {
        const closeId = cmd.tabId || tabId;
        await chrome.tabs.remove(closeId);
        sessions.delete(closeId);
        sendResult(cmd, true, {});
        break;
      }

      case 'switchTab': {
        const switchId = cmd.tabId || tabId;
        await chrome.tabs.update(switchId, { active: true });
        const tab = await chrome.tabs.get(switchId);
        await chrome.windows.update(tab.windowId, { focused: true });
        sendResult(cmd, true, { tabId: switchId, url: tab.url, title: tab.title });
        break;
      }

      case 'getTabList': {
        const tabs = await chrome.tabs.query({});
        sendResult(cmd, true, {
          tabs: tabs.map(t => ({ tabId: t.id, url: t.url, title: t.title, active: t.active }))
        });
        break;
      }

      case 'setStreamingTab': {
        streamingTabId = cmd.tabId || null;
        sendResult(cmd, true, { streamingTabId });
        break;
      }

      default:
        sendResult(cmd, false, null, `Unknown action: ${cmd.action}`);
    }
  } catch (err) {
    sendResult(cmd, false, null, err.message);
  }
}

/* ── Popup message handler ── */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Ignore messages from content scripts (they have a tab)
  if (sender.tab) return false;

  if (msg.type === 'connect') {
    connect().then(() => {
      sendResponse({ status, error: lastError });
    });
    return true;
  }

  if (msg.type === 'disconnect') {
    disconnect();
    sendResponse({ status });
    return false;
  }

  if (msg.type === 'getStatus') {
    chrome.tabs.query({}).then((tabs) => {
      sendResponse({ status, error: lastError, tabCount: tabs.length });
    });
    return true;
  }

  if (msg.type === 'getStreamingTab') {
    getStreamingTab().then((tab) => {
      sendResponse(tab ? { tabId: tab.id, url: tab.url, title: tab.title } : null);
    });
    return true;
  }
});
