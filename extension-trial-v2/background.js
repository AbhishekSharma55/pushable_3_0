/**
 * background.js — Browser Agent v4 (CDP edition)
 *
 * ARCHITECTURE:
 * - Element discovery: chrome.debugger → Accessibility.getFullAXTree
 *   Browser natively traverses ALL shadow roots — no custom DOM walking needed.
 * - All interactions: chrome.debugger → Input.dispatchMouseEvent / Input.insertText
 *   CDP produces isTrusted:true events, bypasses Shadow DOM entirely.
 * - content.js: lightweight only — scroll, waitForDOM, waitForElement, getPageText
 *
 * This eliminates every class of Shadow DOM click failure, menu detection issue,
 * and contentEditable brittleness present in the v1 JS-injection approach.
 */

/* ── Constants ── */
const RECONNECT_DELAY    = 3000;
const FRAME_INTERVAL     = 100;
const FRAME_QUALITY      = 40;
const SCREENSHOT_QUALITY = 85;
const KEEPALIVE_MINUTES  = 0.3;
const PAGE_LOAD_TIMEOUT  = 15000;
const DOM_SETTLE_QUIET   = 400;
const DOM_SETTLE_MAX     = 5000;
const CDP_VERSION        = '1.3';
const CLICK_RETRIES      = 3;
const CLICK_DELAYS       = [0, 300, 800]; // ms before each attempt

/* ── WebSocket / connection state ── */
let ws = null;
let status = 'disconnected';
let lastError = '';
let userDisconnected = false;
let streamingTabId = null;
const sessions = new Map(); // tabId → { queue, running, elementIndex }

/* ── CDP state ── */
const cdpAttached  = new Set();   // tabIds currently attached
const cdpAttaching = new Map();   // tabId → Promise (prevent double-attach races)
const cdpAxEnabled = new Set();   // tabIds where Accessibility domain is enabled

/* ── Agent tab tracking ── */
let lastAgentTabId = null;

/* ════════════════════════════════════════════════════════
 *  CDP SESSION MANAGER
 * ════════════════════════════════════════════════════════ */

/** Attach chrome.debugger to a tab. Idempotent; handles DevTools conflict gracefully. */
async function cdpAttach(tabId) {
  if (cdpAttached.has(tabId)) return true;
  if (cdpAttaching.has(tabId)) return cdpAttaching.get(tabId);

  const p = new Promise((resolve) => {
    chrome.debugger.attach({ tabId }, CDP_VERSION, () => {
      cdpAttaching.delete(tabId);
      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message || '';
        // DevTools already attached — record as attached so send commands still work
        if (msg.includes('Another debugger') || msg.includes('already attached')) {
          cdpAttached.add(tabId);
          resolve(true);
        } else {
          resolve(false);
        }
        return;
      }
      cdpAttached.add(tabId);
      resolve(true);
    });
  });

  cdpAttaching.set(tabId, p);
  return p;
}

/** Detach chrome.debugger. Called on tab close only — persistent attachment is the strategy. */
function cdpDetach(tabId) {
  cdpAxEnabled.delete(tabId);
  if (!cdpAttached.has(tabId)) return;
  chrome.debugger.detach({ tabId }, () => { chrome.runtime.lastError; });
  cdpAttached.delete(tabId);
}

/** Promisified chrome.debugger.sendCommand. Throws typed error on node-not-found. */
function cdpSend(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message || '';
        const err = new Error(`CDP ${method}: ${msg}`);
        if (msg.includes('No node') || msg.includes('Could not find node') ||
            msg.includes('No element') || msg.includes('not found')) {
          err.code = 'CDP_NODE_NOT_FOUND';
        }
        reject(err);
        return;
      }
      resolve(result || {});
    });
  });
}

/** Ensure the Accessibility CDP domain is enabled for this tab (idempotent). */
async function ensureAx(tabId) {
  if (cdpAxEnabled.has(tabId)) return;
  await cdpSend(tabId, 'Accessibility.enable', {});
  cdpAxEnabled.add(tabId);
}

/* Eviction listener — fires when user opens DevTools or tab closes */
chrome.debugger.onDetach.addListener((source, reason) => {
  const tabId = source.tabId;
  cdpAttached.delete(tabId);
  cdpAxEnabled.delete(tabId);
  if (reason === 'canceled_by_user') {
    // DevTools opened — store flag so popup can show a warning
    chrome.storage.session.set({ [`cdpConflict_${tabId}`]: true }).catch(() => {});
  }
});

/* ════════════════════════════════════════════════════════
 *  ELEMENT DISCOVERY — CDP Accessibility Tree
 * ════════════════════════════════════════════════════════ */

const INTERACTIVE_AX_ROLES = new Set([
  'button', 'link', 'textBox', 'comboBox', 'searchBox',
  'checkBox', 'radioButton', 'menuItem', 'menuItemCheckBox', 'menuItemRadio',
  'option', 'tab', 'treeItem', 'slider', 'spinButton', 'switch', 'gridCell',
  'columnHeader', 'rowHeader', 'menuBar', 'listBox',
]);

/**
 * Build element snapshot + index from CDP Accessibility tree.
 * Returns { lines: string[], elementIndex: Map<id, { backendDOMNodeId, role, name }> }
 */
async function getElementsViaCDP(tabId) {
  const attached = await cdpAttach(tabId);
  if (!attached) throw new Error('Cannot attach CDP to this tab');

  await ensureAx(tabId);
  const { nodes } = await cdpSend(tabId, 'Accessibility.getFullAXTree', {});

  const elementIndex = new Map();
  const lines = [];
  let id = 1;

  for (const node of nodes) {
    if (!node.role || !INTERACTIVE_AX_ROLES.has(node.role.value)) continue;
    if (!node.backendDOMNodeId) continue;
    if (node.ignored) continue;

    // Skip nodes explicitly marked hidden
    const hiddenProp = (node.properties || []).find(p => p.name === 'hidden');
    if (hiddenProp?.value?.value === true) continue;

    const role = node.role.value;
    const name = (node.name?.value || '').trim().slice(0, 80);
    const desc = (node.description?.value || '').trim().slice(0, 60);
    const val  = node.value?.value;

    let line = `  [${id}] ${role}`;
    if (name) line += ` "${name}"`;
    if (desc && desc !== name) line += ` desc="${desc}"`;
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      line += ` value="${String(val).slice(0, 50)}"`;
    }

    // State annotations
    const states = node.states || [];
    if (states.includes('focused'))  line += ' [FOCUSED]';
    if (states.includes('checked'))  line += ' [CHECKED]';
    if (states.includes('expanded')) line += ' [EXPANDED]';
    if (states.includes('disabled')) line += ' [DISABLED]';

    // Property annotations
    const props = node.properties || [];
    const hasPopup = props.find(p => p.name === 'hasPopup');
    if (hasPopup?.value?.value && hasPopup.value.value !== 'false') line += ' [ACTION-MENU]';
    const pressed = props.find(p => p.name === 'pressed');
    if (pressed?.value?.value !== undefined) line += ` pressed=${pressed.value.value}`;

    elementIndex.set(id, { backendDOMNodeId: node.backendDOMNodeId, role, name });
    lines.push(line);

    if (id >= 100) break; // cap at 100 elements
    id++;
  }

  return { lines, elementIndex };
}

/** Store fresh element index into the tab's session. */
async function refreshElementIndex(tabId) {
  try {
    const { elementIndex } = await getElementsViaCDP(tabId);
    const session = sessions.get(tabId);
    if (session) session.elementIndex = elementIndex;
    return elementIndex;
  } catch {
    return null;
  }
}

/** Resolve a [N] or N selector to a backendDOMNodeId entry. */
function resolveBackendNode(tabId, selector) {
  const session = sessions.get(tabId);
  if (!session?.elementIndex) return null;

  const s = String(selector).trim();
  // Match [5], [data-psh-id="5"], or bare 5
  const m = s.match(/^\[(\d+)\]$/) ||
            s.match(/data-psh-id="(\d+)"/) ||
            (s.match(/^\d+$/) ? [null, s] : null);
  if (!m) return null;

  const id = parseInt(m[1], 10);
  return session.elementIndex.get(id) || null;
}

/* ════════════════════════════════════════════════════════
 *  CDP INTERACTION HELPERS
 * ════════════════════════════════════════════════════════ */

/** Get center coordinates of a node, scrolling it into view first.
 *  Uses DOM.resolveNode + getBoundingClientRect() — always returns viewport-relative
 *  coordinates, works correctly for shadow DOM nodes at any scroll position.
 */
async function getNodeCenter(tabId, backendDOMNodeId) {
  // Scroll into view (synchronous — no smooth animation)
  try {
    await cdpSend(tabId, 'DOM.scrollIntoViewIfNeeded', { backendNodeId: backendDOMNodeId });
    await new Promise(r => setTimeout(r, 80));
  } catch { /* already visible */ }

  // Resolve backendNodeId → JS object reference
  const { object } = await cdpSend(tabId, 'DOM.resolveNode', { backendNodeId: backendDOMNodeId });

  // getBoundingClientRect() is always viewport-relative, works inside shadow roots
  const { result } = await cdpSend(tabId, 'Runtime.callFunctionOn', {
    objectId: object.objectId,
    functionDeclaration: `function() {
      const r = this.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    }`,
    returnByValue: true,
  });

  // Release the remote object to avoid memory leaks
  await cdpSend(tabId, 'Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});

  if (!result?.value || !result.value.w || !result.value.h) {
    throw new Error('Element has zero size — likely hidden or not rendered');
  }

  return { x: result.value.x, y: result.value.y };
}

/** Dispatch a real mouse click through CDP. */
async function cdpMouseClick(tabId, x, y) {
  await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, modifiers: 0 });
  await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, modifiers: 0 });
}

/* ════════════════════════════════════════════════════════
 *  COMMAND HANDLERS — CDP-based
 * ════════════════════════════════════════════════════════ */

/** Click with retry. Auto-rescans element index on node-not-found. */
async function handleClick(tabId, selector) {
  let entry = resolveBackendNode(tabId, selector);

  // Element not in current index — scan once and retry resolution
  if (!entry) {
    await refreshElementIndex(tabId);
    entry = resolveBackendNode(tabId, selector);
    if (!entry) throw new Error(`Element not found: ${selector}`);
  }

  for (let attempt = 0; attempt < CLICK_RETRIES; attempt++) {
    if (CLICK_DELAYS[attempt] > 0) await new Promise(r => setTimeout(r, CLICK_DELAYS[attempt]));

    try {
      const { x, y } = await getNodeCenter(tabId, entry.backendDOMNodeId);
      await cdpMouseClick(tabId, x, y);
      return { ok: true, x, y, method: 'cdp-mouse', attempt };
    } catch (err) {
      if (err.code === 'CDP_NODE_NOT_FOUND') {
        // Node was removed from DOM between scan and click — rescan and retry
        if (attempt < CLICK_RETRIES - 1) {
          await refreshElementIndex(tabId);
          const refreshed = resolveBackendNode(tabId, selector);
          if (refreshed) entry = refreshed;
        }
        continue;
      }
      throw err;
    }
  }

  throw new Error(`Click failed after ${CLICK_RETRIES} attempts: ${selector}`);
}

/** Type text into an element. Uses CDP Input.insertText for broad compatibility. */
async function handleType(tabId, selector, text) {
  const attached = await cdpAttach(tabId);
  if (!attached) throw new Error('Cannot attach CDP');

  // Step 1: Click to focus
  const entry = resolveBackendNode(tabId, selector);
  if (entry) {
    try {
      const { x, y } = await getNodeCenter(tabId, entry.backendDOMNodeId);
      await cdpMouseClick(tabId, x, y);
    } catch { /* focus best-effort */ }
  }

  // Step 2: Wait for lazy editor activation (Reddit, LinkedIn, etc.)
  await new Promise(r => setTimeout(r, 600));

  // Step 3: Ensure an editable element is focused
  await cdpSend(tabId, 'Runtime.evaluate', {
    expression: `(() => {
      let el = document.activeElement;
      while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
      if (el && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) return true;
      const selectors = '[contenteditable="true"], [contenteditable=""], textarea:not([disabled]), .ProseMirror, .ql-editor, [role="textbox"][contenteditable]';
      function find(root, d) {
        if (d > 8) return null;
        try { for (const c of root.querySelectorAll(selectors)) { if (c.getBoundingClientRect().width > 0) { c.focus(); return c; } }
          for (const c of root.querySelectorAll('*')) { if (c.shadowRoot) { const f = find(c.shadowRoot, d+1); if (f) return f; } }
        } catch {} return null;
      }
      find(document, 0); return true;
    })()`,
    returnByValue: true,
  }).catch(() => {});

  // Step 4: Ctrl+A + Delete
  await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', modifiers: 2, code: 'KeyA', windowsVirtualKeyCode: 65 });
  await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp',   key: 'a', modifiers: 2, code: 'KeyA', windowsVirtualKeyCode: 65 });
  await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
  await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp',   key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
  await new Promise(r => setTimeout(r, 50));

  // Step 5: Insert text
  await cdpSend(tabId, 'Input.insertText', { text });

  // Step 6: Verify and fallback to char-by-char if needed
  await new Promise(r => setTimeout(r, 200));
  const verify = await cdpSend(tabId, 'Runtime.evaluate', {
    expression: `(() => {
      let el = document.activeElement;
      while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
      if (!el) return false;
      const c = el.isContentEditable ? (el.innerText || '').trim() : (el.value || '').trim();
      return c.length > 0;
    })()`,
    returnByValue: true,
  }).catch(() => ({ result: { value: true } }));

  if (!verify?.result?.value) {
    for (const char of text) {
      await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: char, text: char, unmodifiedText: char });
      await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: char });
      await new Promise(r => setTimeout(r, 40));
    }
  }

  return { ok: true };
}

/** Type text character by character with delay (simulates human typing). */
async function handleTypeChar(tabId, selector, text, delay = 80) {
  const attached = await cdpAttach(tabId);
  if (!attached) throw new Error('Cannot attach CDP');

  // Click to focus
  const entry = resolveBackendNode(tabId, selector);
  if (entry) {
    try {
      const { x, y } = await getNodeCenter(tabId, entry.backendDOMNodeId);
      await cdpMouseClick(tabId, x, y);
      await new Promise(r => setTimeout(r, 100));
    } catch { /* focus best-effort */ }
  }

  for (const char of text) {
    await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: char, text: char, unmodifiedText: char });
    await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp',   key: char });
    if (delay > 0) await new Promise(r => setTimeout(r, delay));
  }

  return { ok: true };
}

const KEY_MAP = {
  Enter:      { key: 'Enter',      code: 'Enter',      windowsVirtualKeyCode: 13 },
  Tab:        { key: 'Tab',        code: 'Tab',        windowsVirtualKeyCode: 9  },
  Escape:     { key: 'Escape',     code: 'Escape',     windowsVirtualKeyCode: 27 },
  Backspace:  { key: 'Backspace',  code: 'Backspace',  windowsVirtualKeyCode: 8  },
  Delete:     { key: 'Delete',     code: 'Delete',     windowsVirtualKeyCode: 46 },
  Space:      { key: ' ',          code: 'Space',      windowsVirtualKeyCode: 32 },
  ArrowUp:    { key: 'ArrowUp',    code: 'ArrowUp',    windowsVirtualKeyCode: 38 },
  ArrowDown:  { key: 'ArrowDown',  code: 'ArrowDown',  windowsVirtualKeyCode: 40 },
  ArrowLeft:  { key: 'ArrowLeft',  code: 'ArrowLeft',  windowsVirtualKeyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
};

/** Press a named key via CDP. */
async function handleKeypress(tabId, key) {
  const attached = await cdpAttach(tabId);
  if (!attached) throw new Error('Cannot attach CDP');

  const k = KEY_MAP[key] || { key, code: key, windowsVirtualKeyCode: 0 };
  await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: k.key, code: k.code, windowsVirtualKeyCode: k.windowsVirtualKeyCode });
  // For printable Space send keypress too
  if (key === 'Space') {
    await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyPress', key: k.key, code: k.code, windowsVirtualKeyCode: k.windowsVirtualKeyCode });
  }
  await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.windowsVirtualKeyCode });
  return { ok: true };
}

/** Hover over an element via CDP. */
async function handleHover(tabId, selector) {
  const entry = resolveBackendNode(tabId, selector);
  if (!entry) throw new Error(`Element not found for hover: ${selector}`);

  const { x, y } = await getNodeCenter(tabId, entry.backendDOMNodeId);
  await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  return { ok: true, x, y };
}

/** Build LLM snapshot from CDP AX tree + page text. */
async function handleGetElements(tabId) {
  const tab = await chrome.tabs.get(tabId);

  // Get page text from content script (lightweight)
  let pageText = '';
  try {
    const info = await sendToContent(tabId, { action: 'getPageText' });
    pageText = info?.text || '';
  } catch { /* non-critical */ }

  const { lines, elementIndex } = await getElementsViaCDP(tabId);

  // Store index for click resolution
  const session = sessions.get(tabId);
  if (session) session.elementIndex = elementIndex;

  const snapshot = [
    `PAGE: ${tab.url}`,
    `TITLE: ${tab.title}`,
    pageText ? `TEXT: ${pageText}` : '',
    '',
    `ELEMENTS (use [N] as selector):`,
    ...lines,
  ].filter(l => l !== undefined).join('\n');

  return { snapshot };
}

/* ════════════════════════════════════════════════════════
 *  V1 DOM FALLBACK (for chrome:// pages, DevTools conflict)
 * ════════════════════════════════════════════════════════ */

/**
 * Fallback click — pure MAIN world, no content.js dependency.
 * Used when CDP is unavailable (chrome:// pages, DevTools conflict).
 * Searches by the element's accessible name using deep shadow DOM traversal.
 */
async function handleClickFallback(tabId, selector) {
  // Get the human-readable name from the session index (if available)
  const entry = resolveBackendNode(tabId, selector);
  const labelText = entry?.name || '';

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN',
    func: (label) => {
      // Deep search through shadow DOM by aria-label or text content
      function findByLabel(root, depth) {
        if (depth > 8) return null;
        const candidates = root.querySelectorAll(
          'button, a[href], input, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [aria-label]'
        );
        for (const el of candidates) {
          const text = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
          if (label && text.toLowerCase().includes(label.toLowerCase())) return el;
        }
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) {
            const found = findByLabel(el.shadowRoot, depth + 1);
            if (found) return found;
          }
        }
        return null;
      }

      const el = label ? findByLabel(document, 0) : null;
      if (!el) return { ok: false, error: `Element not found in fallback: "${label}"` };
      try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); el.click(); } catch {}
      return { ok: true, tag: el.tagName?.toLowerCase(), method: 'dom-fallback' };
    },
    args: [labelText]
  });
  return result;
}

/* ════════════════════════════════════════════════════════
 *  POPUP BLOCKER BYPASS
 * ════════════════════════════════════════════════════════ */
chrome.webNavigation.onCreatedNavigationTarget.addListener(() => {});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN',
    func: () => {
      if (window.__psh_popup_bypass) return;
      window.__psh_popup_bypass = true;
      const origOpen = window.open;
      window.open = function(url, target, features) {
        if (url) {
          const w = origOpen.call(window, url, target, features);
          if (!w) { window.dispatchEvent(new CustomEvent('__psh_blocked_popup', { detail: { url } })); window.location.href = url; }
          return w;
        }
        return origOpen.call(window, url, target, features);
      };
    }
  }).catch(() => {});
});

/* ════════════════════════════════════════════════════════
 *  KEEPALIVE
 * ════════════════════════════════════════════════════════ */
chrome.alarms.create('keepalive', { periodInMinutes: KEEPALIVE_MINUTES });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive' && !userDisconnected && status === 'disconnected') connect();
});
setInterval(() => { if (!userDisconnected && status === 'disconnected') connect(); }, 20000);

/* ════════════════════════════════════════════════════════
 *  WEBSOCKET
 * ════════════════════════════════════════════════════════ */
async function getWsUrl() {
  const data = await chrome.storage.local.get(['serverUrl', 'apiKey']);
  if (!data.serverUrl) return null;
  const key = data.apiKey || '';
  return key ? `${data.serverUrl}?key=${encodeURIComponent(key)}` : data.serverUrl;
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

async function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const url = await getWsUrl();
  if (!url) { status = 'error'; lastError = 'No server URL'; return; }

  status = 'connecting'; lastError = ''; userDisconnected = false;
  try { ws = new WebSocket(url); } catch (err) { status = 'error'; lastError = err.message; return; }

  ws.onopen = async () => {
    status = 'connected'; lastError = '';
    const tabs = await chrome.tabs.query({});
    send({ type: 'status', status: 'connected', tabs: tabs.map(t => ({ tabId: t.id, url: t.url, title: t.title })) });
    startFrameLoop();
  };

  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type === 'ping') { send({ type: 'pong' }); return; }
    if (msg.commandId && msg.action) enqueue(msg);
  };

  ws.onclose = (event) => {
    ws = null; stopFrameLoop();
    if (event.code >= 4000 && event.code < 5000) { status = 'error'; lastError = event.reason || `Auth failed (${event.code})`; return; }
    status = 'disconnected';
    if (!userDisconnected) setTimeout(connect, RECONNECT_DELAY);
  };

  ws.onerror = () => { status = 'error'; lastError = 'WebSocket error'; };
}

function disconnect() {
  userDisconnected = true;
  if (ws) { ws.close(1000, 'User disconnected'); ws = null; }
  status = 'disconnected'; lastError = '';
  stopFrameLoop();
}

/* ════════════════════════════════════════════════════════
 *  TAB EVENTS
 * ════════════════════════════════════════════════════════ */
chrome.tabs.onCreated.addListener((tab) => send({ type: 'tabEvent', event: 'created', tabId: tab.id, url: tab.url || '', title: tab.title || '' }));
chrome.tabs.onRemoved.addListener((tabId) => {
  sessions.delete(tabId);
  cdpDetach(tabId);
  send({ type: 'tabEvent', event: 'closed', tabId });
});
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.title) send({ type: 'tabEvent', event: 'updated', tabId, url: tab.url, title: tab.title });
});

// Invalidate element index when page navigation completes
chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return;
  const session = sessions.get(details.tabId);
  if (session) session.elementIndex = null; // force re-scan on next getElements
});

/* ════════════════════════════════════════════════════════
 *  FRAME STREAMING
 * ════════════════════════════════════════════════════════ */
let frameTimer = null;
function startFrameLoop() { stopFrameLoop(); frameTimer = setInterval(captureFrame, FRAME_INTERVAL); }
function stopFrameLoop() { if (frameTimer) { clearInterval(frameTimer); frameTimer = null; } }
async function captureFrame() {
  try {
    const tab = await getStreamingTab();
    if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: FRAME_QUALITY });
    send({ type: 'frame', tabId: tab.id, url: tab.url, title: tab.title, data: dataUrl });
  } catch {}
}
async function getStreamingTab() {
  if (streamingTabId) { try { return await chrome.tabs.get(streamingTabId); } catch { streamingTabId = null; } }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/* ════════════════════════════════════════════════════════
 *  COMMAND QUEUE
 * ════════════════════════════════════════════════════════ */
function isProtectedTab(tab) {
  if (!tab?.url) return false;
  const u = tab.url;
  if (u.startsWith('chrome://') || u.startsWith('chrome-extension://') || u.startsWith('about:')) return true;
  try {
    const url = new URL(u);
    const h = url.hostname;
    if (h === 'localhost' && ['3000', '3001', '3002'].includes(url.port)) return true;
    if (h === 'platform.pushable.ai') return true;
    if (h.endsWith('pushable.ai')) return true;
    if (h.includes('pushable')) return true;
  } catch {}
  return false;
}

function enqueue(cmd) {
  const tabFree = ['getTabList', 'newTab'];
  if (tabFree.includes(cmd.action)) { executeCommand(cmd, null); return; }
  if (!cmd.tabId) {
    if (lastAgentTabId) {
      chrome.tabs.get(lastAgentTabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          lastAgentTabId = null;
          sendResult(cmd, false, null, 'No automation tab open. Use ext_browser_new_tab(url) first.');
        } else {
          cmd.tabId = lastAgentTabId; enqueueForTab(cmd);
        }
      });
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (tab && !isProtectedTab(tab)) { cmd.tabId = tab.id; enqueueForTab(cmd); }
        else sendResult(cmd, false, null, 'No automation tab open. Use ext_browser_new_tab(url) first.');
      });
    }
    return;
  }
  enqueueForTab(cmd);
}

function enqueueForTab(cmd) {
  const tabId = cmd.tabId;
  if (!sessions.has(tabId)) sessions.set(tabId, { queue: [], running: false, elementIndex: null });
  sessions.get(tabId).queue.push(cmd);
  drainQueue(tabId);
}

async function drainQueue(tabId) {
  const session = sessions.get(tabId);
  if (!session || session.running) return;
  session.running = true;
  while (session.queue.length > 0) await executeCommand(session.queue.shift(), tabId);
  session.running = false;
}

function sendResult(cmd, success, data, error) {
  send({ type: 'result', commandId: cmd.commandId, tabId: cmd.tabId || null, success, action: cmd.action,
    ...(success ? { data } : { error: error || 'Unknown error' }) });
}

/* ════════════════════════════════════════════════════════
 *  HELPERS
 * ════════════════════════════════════════════════════════ */
async function ensureContentScript(tabId) {
  try { await chrome.tabs.sendMessage(tabId, { action: 'ping' }); return true; }
  catch { try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); await new Promise(r => setTimeout(r, 200)); return true; } catch { return false; } }
}

function sendToContent(tabId, msg) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, (res) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res);
    });
  });
}

function waitForPageLoad(tabId, timeout = PAGE_LOAD_TIMEOUT) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { chrome.webNavigation.onCompleted.removeListener(listener); resolve(); }, timeout);
    function listener(details) {
      if (details.tabId === tabId && details.frameId === 0) {
        clearTimeout(timer); chrome.webNavigation.onCompleted.removeListener(listener); setTimeout(resolve, 500);
      }
    }
    chrome.webNavigation.onCompleted.addListener(listener);
  });
}

async function settleDOM(tabId) {
  try { await sendToContent(tabId, { action: 'waitForDOM', quietMs: DOM_SETTLE_QUIET, maxMs: DOM_SETTLE_MAX }); }
  catch { await new Promise(r => setTimeout(r, 800)); await ensureContentScript(tabId); }
}

/** Determine if CDP is usable for this tab (not a chrome:// page). */
async function canUseCDP(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return false;
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) return false;
    return true;
  } catch { return false; }
}

/* ════════════════════════════════════════════════════════
 *  COMMAND EXECUTION
 * ════════════════════════════════════════════════════════ */
async function executeCommand(cmd, tabId) {
  try {
    if (tabId && !['getTabList', 'newTab'].includes(cmd.action)) {
      lastAgentTabId = tabId;
    }
    if (tabId) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://'))) {
          if (!['navigate', 'newTab', 'getTabList', 'switchTab', 'closeTab', 'screenshot'].includes(cmd.action)) {
            sendResult(cmd, false, null, 'Cannot interact with chrome:// pages'); return;
          }
        }
      } catch { sendResult(cmd, false, null, `Tab ${tabId} not found`); return; }
    }

    switch (cmd.action) {

      /* ── Navigation ── */
      case 'navigate': {
        let url = cmd.url;
        if (url && !url.startsWith('http') && !url.startsWith('file:')) url = 'https://' + url;

        let targetTabId = tabId;
        if (tabId) {
          try {
            const currentTab = await chrome.tabs.get(tabId);
            if (isProtectedTab(currentTab)) {
              const newTab = await chrome.tabs.create({ url, active: true });
              await waitForPageLoad(newTab.id);
              await ensureContentScript(newTab.id);
              lastAgentTabId = newTab.id;
              sendResult(cmd, true, { url: newTab.url, title: newTab.title, newTabId: newTab.id });
              break;
            }
          } catch {}
        }

        await chrome.tabs.update(targetTabId, { url });
        await waitForPageLoad(targetTabId);
        await ensureContentScript(targetTabId);
        lastAgentTabId = targetTabId;
        const tab = await chrome.tabs.get(targetTabId);
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
        await chrome.scripting.executeScript({ target: { tabId }, func: () => history.back() });
        await waitForPageLoad(tabId).catch(() => {});
        await ensureContentScript(tabId);
        sendResult(cmd, true, {});
        break;
      }

      case 'waitForNavigation': {
        const result = await new Promise((resolve) => {
          const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve({ ok: false, error: 'Timeout' }); }, cmd.timeout || 10000);
          function listener(id, info) {
            if (id === tabId && info.url) { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); setTimeout(() => resolve({ ok: true, url: info.url }), 500); }
          }
          chrome.tabs.onUpdated.addListener(listener);
        });
        sendResult(cmd, result.ok !== false, result);
        break;
      }

      /* ── Click ── */
      case 'click': {
        const cdpOk = await canUseCDP(tabId);
        if (cdpOk) {
          const attached = await cdpAttach(tabId);
          if (attached) {
            // Ensure we have a fresh element index for this tab
            if (!sessions.get(tabId)?.elementIndex) {
              await refreshElementIndex(tabId);
            }
            try {
              const result = await handleClick(tabId, cmd.selector);
              sendResult(cmd, result?.ok !== false, result, result?.error);
              break;
            } catch (err) {
              // CDP click failed — fall through to DOM fallback
              console.error('CDP click failed, trying fallback:', err.message);
            }
          }
        }
        // DOM fallback (DevTools open, chrome:// page, or CDP failure)
        try {
          await ensureContentScript(tabId);
          const result = await handleClickFallback(tabId, cmd.selector);
          sendResult(cmd, result?.ok !== false, result, result?.error);
        } catch (err) {
          sendResult(cmd, false, null, err.message);
        }
        break;
      }

      /* ── Click by visible text ── */
      case 'clickText': {
        const searchText = (cmd.text || '').trim();
        if (!searchText) { sendResult(cmd, false, null, 'No text provided'); break; }

        let urlBefore = '';
        try { const tb = await chrome.tabs.get(tabId); urlBefore = tb.url || ''; } catch {}

        try {
          const [{ result: found }] = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (text) => {
              const SUBMIT_WORDS = ['send', 'comment', 'post', 'submit', 'reply', 'publish', 'save', 'done', 'ok', 'confirm'];
              const isSubmitAction = SUBMIT_WORDS.includes(text.toLowerCase().trim());
              const candidates = [];
              function walk(root, depth) {
                if (depth > 8) return;
                try {
                  for (const el of root.querySelectorAll('*')) {
                    const elText = (el.textContent || '').trim().replace(/\s+/g, ' ');
                    if (!elText.toLowerCase().includes(text.toLowerCase())) continue;
                    const rect = el.getBoundingClientRect();
                    if (rect.width === 0 || rect.height === 0) continue;
                    if (rect.width > window.innerWidth * 0.8 && rect.height > window.innerHeight * 0.5) continue;
                    try { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden') continue; } catch { continue; }
                    const tag = el.tagName;
                    const hasPopup = el.getAttribute('aria-haspopup');
                    if (hasPopup === 'true' || hasPopup === 'menu') continue;
                    if (tag === 'BUTTON' && el.getAttribute('aria-expanded') !== null) continue;
                    let score = 0;
                    if (tag === 'A' && el.href) { score += 20; if (el.href.includes('/in/')) score += 10; }
                    else if (el.tabIndex >= 0 && !['BUTTON', 'A', 'INPUT'].includes(tag)) score += 15;
                    else if (tag === 'A') score += 12;
                    else if (tag === 'BUTTON') score += 6;
                    else if (el.getAttribute('role') === 'button') score += 6;
                    score += Math.max(0, 5 - Math.floor(elText.length / 50));
                    if (elText.trim().toLowerCase() === text.toLowerCase()) score += 10;
                    if (elText.trim().toLowerCase().startsWith(text.toLowerCase())) score += 7;
                    // Submit button detection — prefer actual submit over action-bar duplicates
                    if (isSubmitAction && (tag === 'BUTTON' || el.getAttribute('role') === 'button')) {
                      if (el.type === 'submit') score += 25;
                      if (el.closest('form, [role="form"], .msg-form, .comments-comment-box, .editor-container')) score += 20;
                      const cls = (el.className || '').toLowerCase();
                      if (cls.includes('submit') || cls.includes('send') || cls.includes('post') || cls.includes('primary')) score += 15;
                      try { const bg = getComputedStyle(el).backgroundColor; if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'rgb(255, 255, 255)') score += 12; } catch {}
                      const parent = el.parentElement;
                      if (parent) { if (parent.querySelector('[contenteditable], textarea, .ql-editor')) score += 15; const gp = parent.parentElement; if (gp && gp.querySelector('[contenteditable], textarea')) score += 10; }
                      score += Math.min(15, Math.floor(rect.top / 50));
                    }
                    const lbl = elText.toLowerCase();
                    if (lbl.includes('premium') || lbl.includes('upgrade')) score -= 20;
                    if (tag === 'BUTTON' && (lbl.includes('connect') || lbl.includes('follow'))) score -= 5;
                    if (isSubmitAction && tag === 'SPAN' && el.closest('[class*="social-action"]')) score -= 15;
                    candidates.push({ el, score, text: elText.slice(0, 80) });
                    if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
                  }
                } catch {}
              }
              walk(document, 0);
              if (candidates.length === 0) return null;
              candidates.sort((a, b) => b.score - a.score);
              const best = candidates[0];
              best.el.scrollIntoView({ block: 'center', behavior: 'instant' });
              const r = best.el.getBoundingClientRect();
              return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: best.text, tag: best.el.tagName.toLowerCase() };
            },
            args: [searchText]
          });

          if (!found) { sendResult(cmd, false, null, `No visible element found containing "${searchText}"`); break; }

          const cdpOk2 = await canUseCDP(tabId);
          if (cdpOk2) {
            const attached2 = await cdpAttach(tabId);
            if (attached2) {
              try { await cdpMouseClick(tabId, found.x, found.y); }
              catch { await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: (x, y) => { const el = document.elementFromPoint(x, y); if (el) el.click(); }, args: [found.x, found.y] }); }
            }
          } else {
            await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: (x, y) => { const el = document.elementFromPoint(x, y); if (el) el.click(); }, args: [found.x, found.y] });
          }

          await new Promise(r => setTimeout(r, 400));
          let urlChanged = false;
          try { const ta = await chrome.tabs.get(tabId); urlChanged = ta.url !== urlBefore; } catch { urlChanged = true; }
          sendResult(cmd, true, { ok: true, clicked: found.text, tag: found.tag, urlChanged });
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      /* ── Click by viewport coordinates (normalized 0-1) ── */
      case 'clickPoint': {
        const cdpOk = await canUseCDP(tabId);
        if (cdpOk) {
          const attached = await cdpAttach(tabId);
          if (attached) {
            try {
              // Get viewport size
              const { result: vp } = await cdpSend(tabId, 'Runtime.evaluate', {
                expression: `({w: window.innerWidth, h: window.innerHeight})`,
                returnByValue: true
              });
              const px = Math.round((cmd.x || 0) * (vp?.value?.w || 1280));
              const py = Math.round((cmd.y || 0) * (vp?.value?.h || 720));
              await cdpMouseClick(tabId, px, py);
              sendResult(cmd, true, { ok: true, x: px, y: py });
              break;
            } catch (err) {
              console.error('CDP clickPoint failed:', err.message);
            }
          }
        }
        try {
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (nx, ny) => {
              const px = Math.round(nx * window.innerWidth), py = Math.round(ny * window.innerHeight);
              const el = document.elementFromPoint(px, py);
              if (!el) return { ok: false, error: `No element at (${px},${py})` };
              el.click();
              return { ok: true, x: px, y: py, tag: el.tagName.toLowerCase() };
            },
            args: [cmd.x, cmd.y]
          });
          sendResult(cmd, result?.ok !== false, result, result?.error);
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      /* ── Type into editor — atomic click-placeholder → find-editor → type ── */
      /* ── Click overflow/three-dot menu near content, then click a menu item ── */
      case 'clickOverflowMenu': {
        const nearText = (cmd.nearText || '').trim();
        const menuAction = (cmd.menuAction || '').trim();
        if (!menuAction) { sendResult(cmd, false, null, 'No menuAction specified'); break; }
        try {
          // Step 1: Find and click overflow button near text
          const [{ result: mb }] = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (nearText) => {
              const buttons = [];
              function fb(root, d) { if (d > 12) return; try {
                for (const el of root.querySelectorAll('button,[role="button"]')) {
                  const l = (el.getAttribute('aria-label') || '').toLowerCase();
                  const t = (el.textContent || '').trim().toLowerCase();
                  if (l.includes('more') || l.includes('option') || l.includes('overflow') || l.includes('menu') || l.includes('action') || t === '...' || t === '⋯' || t === '⋮' || t === '…' || (t === '' && el.querySelector('svg'))) {
                    const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) buttons.push({ el, rect: r, label: l || t || 'menu' });
                  }
                }
                for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) fb(el.shadowRoot, d + 1); }
              } catch {} }
              fb(document, 0);
              if (!buttons.length) return { ok: false, error: 'No overflow buttons found' };
              let best = buttons[0];
              if (nearText) {
                let nearEl = null;
                function fn(root, d) { if (d > 12 || nearEl) return; try {
                  for (const el of root.querySelectorAll('*')) { const t = (el.textContent || '').trim(); if (t.toLowerCase().includes(nearText.toLowerCase()) && t.length < 500) { const r = el.getBoundingClientRect(); if (r.width > 20 && r.height > 10) { nearEl = { rect: r }; return; } } }
                  for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) fn(el.shadowRoot, d + 1); }
                } catch {} }
                fn(document, 0);
                if (nearEl) { let bd = Infinity; for (const b of buttons) { const d = Math.abs(b.rect.top - nearEl.rect.top) * 2 + Math.abs(b.rect.left - nearEl.rect.left); if (d < bd) { bd = d; best = b; } } }
              }
              best.el.scrollIntoView({ block: 'center', behavior: 'instant' }); best.el.click();
              const r = best.el.getBoundingClientRect();
              return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, label: best.label };
            }, args: [nearText]
          });
          if (!mb?.ok) { sendResult(cmd, false, null, mb?.error || 'Could not find overflow button'); break; }
          const cdpOk3 = await canUseCDP(tabId);
          if (cdpOk3) { const a = await cdpAttach(tabId); if (a) try { await cdpMouseClick(tabId, mb.x, mb.y); } catch {} }
          await new Promise(r => setTimeout(r, 800));
          // Step 2: Click menu action — scan ALL elements (Reddit renders menus as overlays)
          const [{ result: ar }] = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (action) => {
              const cands = []; const aLow = action.toLowerCase();
              function scan(root, d) { if (d > 12) return; try {
                for (const el of root.querySelectorAll('*')) {
                  const t = (el.textContent || '').trim();
                  if (!t.toLowerCase().includes(aLow) || t.length > 200) continue;
                  const r = el.getBoundingClientRect();
                  if (!r.width || !r.height || r.top < -100 || r.top > window.innerHeight + 100) continue;
                  try { if (getComputedStyle(el).display === 'none') continue; } catch { continue; }
                  let sc = 0; const role = el.getAttribute('role'); const tag = el.tagName;
                  if (role === 'menuitem') sc += 20; if (tag === 'BUTTON') sc += 10; if (tag === 'A') sc += 8; if (tag === 'LI') sc += 5;
                  sc += Math.max(0, 10 - Math.floor(t.length / 20));
                  if (t.toLowerCase() === aLow) sc += 15; if (t.toLowerCase().startsWith(aLow)) sc += 10;
                  if (r.width < 400 && r.height < 60) sc += 5;
                  cands.push({ el, text: t.slice(0, 80), score: sc, x: r.left + r.width / 2, y: r.top + r.height / 2 });
                  if (el.shadowRoot) scan(el.shadowRoot, d + 1);
                }
              } catch {} }
              scan(document, 0);
              if (!cands.length) return { ok: false, error: 'Menu item "' + action + '" not found' };
              cands.sort((a, b) => b.score - a.score);
              const best = cands[0]; best.el.click();
              return { ok: true, clicked: best.text, x: best.x, y: best.y };
            }, args: [menuAction]
          });
          if (!ar?.ok) { sendResult(cmd, false, null, ar?.error || 'Could not find menu action'); break; }
          if (cdpOk3 && ar.x) { try { await cdpMouseClick(tabId, ar.x, ar.y); } catch {} }
          // Step 3: Auto-confirm dialog
          await new Promise(r => setTimeout(r, 800));
          const [{ result: cr2 }] = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (action) => {
              function fc(root, d) { if (d > 12) return null; try {
                const words = [action.toLowerCase(), 'yes', 'confirm', 'ok', 'delete'];
                for (const el of root.querySelectorAll('button,[role="button"]')) { const t = (el.textContent || '').trim().toLowerCase(); if (words.some(w => t.includes(w))) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) { el.click(); return { ok: true, confirmed: t }; } } }
                for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) { const f = fc(el.shadowRoot, d + 1); if (f) return f; } }
              } catch {} return null; }
              return fc(document, 0) || { ok: true, confirmed: false };
            }, args: [menuAction]
          });
          sendResult(cmd, true, { ok: true, menuClicked: mb.label, actionClicked: ar.clicked, confirmed: cr2?.confirmed || false });
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      case 'typeIntoEditor': {
        const editorText = cmd.text || '';
        const placeholderHint = cmd.placeholder || 'Join the conversation';
        if (!editorText) { sendResult(cmd, false, null, 'No text to type'); break; }
        try {
          const cdpOk2 = await canUseCDP(tabId);
          const attached2 = cdpOk2 ? await cdpAttach(tabId) : false;
          // Step 1: Find and click placeholder via MAIN world (walks all shadow DOMs)
          const [{ result: cr }] = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (hint) => {
              function find(root, d) {
                if (d > 12) return null;
                try {
                  for (const el of root.querySelectorAll('[contenteditable="true"],[contenteditable=""],textarea,.ProseMirror,.ql-editor,[role="textbox"]')) {
                    const r = el.getBoundingClientRect(); if (r.width > 50 && r.height > 10) { try { if (getComputedStyle(el).display === 'none') continue; } catch {} return el; }
                  }
                  for (const el of root.querySelectorAll('*')) {
                    const t = (el.textContent || '').trim();
                    if (t.toLowerCase().includes(hint.toLowerCase()) && t.length < 200) { const r = el.getBoundingClientRect(); if (r.width > 50 && r.height > 10) return el; }
                  }
                  for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) { const f = find(el.shadowRoot, d + 1); if (f) return f; } }
                } catch {} return null;
              }
              const t = find(document, 0);
              if (!t) return { ok: false, error: 'No editor or placeholder found' };
              t.scrollIntoView({ block: 'center', behavior: 'instant' }); t.click();
              const r = t.getBoundingClientRect();
              return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
            }, args: [placeholderHint]
          });
          if (!cr?.ok) { sendResult(cmd, false, null, cr?.error || 'Could not find editor'); break; }
          if (attached2) { try { await cdpMouseClick(tabId, cr.x, cr.y); } catch {} }
          // Step 2: Wait for editor
          await new Promise(r => setTimeout(r, 1200));
          // Step 3: Focus the editor
          const [{ result: fr }] = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: () => {
              function find(root, d) {
                if (d > 12) return null;
                try {
                  for (const el of root.querySelectorAll('[contenteditable="true"],[contenteditable=""],textarea,.ProseMirror,.ql-editor')) {
                    const r = el.getBoundingClientRect(); if (r.width > 50 && r.height > 10) { try { if (getComputedStyle(el).display === 'none') continue; } catch {} el.focus(); el.click(); return { ok: true, r: { x: r.left + r.width / 2, y: r.top + r.height / 2 } }; }
                  }
                  for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) { const f = find(el.shadowRoot, d + 1); if (f) return f; } }
                } catch {} return null;
              }
              return find(document, 0) || { ok: false };
            }, args: []
          });
          if (attached2 && fr?.r) { try { await cdpMouseClick(tabId, fr.r.x, fr.r.y); } catch {} await new Promise(r => setTimeout(r, 300)); }
          // Step 4: Type char-by-char via CDP
          if (attached2) {
            // Method A: insertText (atomic, no double chars)
            await cdpSend(tabId, 'Input.insertText', { text: editorText });
            await new Promise(r => setTimeout(r, 300));
            // Check and fallback to execCommand if needed
            const [{ result: chkA }] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN',
              func: () => { function f(r,d){if(d>12)return null;try{for(const e of r.querySelectorAll('[contenteditable="true"],[contenteditable=""],textarea,.ProseMirror')){const t=e.isContentEditable?(e.innerText||'').trim():(e.value||'').trim();if(t.length>0)return true;}for(const e of r.querySelectorAll('*')){if(e.shadowRoot){const x=f(e.shadowRoot,d+1);if(x)return x;}}}catch{}return null;}return f(document,0)||false; },
              args: [] });
            if (!chkA?.result) {
              await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN',
                func: (text) => { function f(r,d){if(d>12)return null;try{for(const e of r.querySelectorAll('[contenteditable="true"],[contenteditable=""],textarea,.ProseMirror')){if(e.getBoundingClientRect().width>50){e.focus();return e;}}for(const e of r.querySelectorAll('*')){if(e.shadowRoot){const x=f(e.shadowRoot,d+1);if(x)return x;}}}catch{}return null;}const el=f(document,0);if(el&&el.isContentEditable){el.focus();document.execCommand('insertText',false,text);}else if(el){el.value=text;el.dispatchEvent(new Event('input',{bubbles:true}));} },
                args: [editorText] });
            }
          } else {
            await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN',
              func: (text) => { const el = document.activeElement; if (el?.isContentEditable) document.execCommand('insertText', false, text); else if (el) { el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); } },
              args: [editorText] });
          }
          // Step 5: Verify
          await new Promise(r => setTimeout(r, 300));
          const [{ result: vr }] = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: () => {
              function check(root, d) {
                if (d > 12) return null;
                try {
                  for (const el of root.querySelectorAll('[contenteditable="true"],[contenteditable=""],textarea,.ProseMirror')) {
                    const t = el.isContentEditable ? (el.innerText || '').trim() : (el.value || '').trim();
                    if (t.length > 0) return { ok: true, content: t.slice(0, 100) };
                  }
                  for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) { const f = check(el.shadowRoot, d + 1); if (f) return f; } }
                } catch {} return null;
              }
              return check(document, 0) || { ok: false };
            }, args: []
          });
          sendResult(cmd, true, { ok: true, typed: editorText, verified: vr?.ok || false, content: vr?.content || '' });
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      /* ── Type ── */
      case 'type': {
        const cdpOk = await canUseCDP(tabId);
        if (cdpOk) {
          const attached = await cdpAttach(tabId);
          if (attached) {
            // Ensure we have a fresh element index
            if (!sessions.get(tabId)?.elementIndex) {
              await refreshElementIndex(tabId);
            }
            try {
              const result = await handleType(tabId, cmd.selector, cmd.text);
              sendResult(cmd, result?.ok !== false, result, result?.error);
              break;
            } catch (err) {
              console.error('CDP type failed, trying fallback:', err.message);
            }
          }
        }
        // DOM fallback — find by label text, no getClickCoords dependency
        try {
          const fallbackLabel = resolveBackendNode(tabId, cmd.selector)?.name || '';
          await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (label) => {
              function findByLabel(root, depth) {
                if (depth > 8) return null;
                for (const el of root.querySelectorAll('input, textarea, [contenteditable], [role="textbox"]')) {
                  const text = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || '').trim();
                  if (!label || text.toLowerCase().includes(label.toLowerCase())) return el;
                }
                for (const el of root.querySelectorAll('*')) {
                  if (el.shadowRoot) { const f = findByLabel(el.shadowRoot, depth + 1); if (f) return f; }
                }
                return null;
              }
              const el = findByLabel(document, 0) || document.activeElement;
              if (el && el !== document.body) { el.scrollIntoView({ block: 'center', behavior: 'instant' }); el.focus?.(); el.click(); }
            },
            args: [fallbackLabel]
          });
          await settleDOM(tabId);
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (text) => {
              let el = document.activeElement;
              while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
              if (!el || (!el.isContentEditable && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') || el === document.body) {
                function findEditor(root) {
                  for (const c of root.querySelectorAll('*')) {
                    if ((c.isContentEditable || c.tagName === 'TEXTAREA') && c.getBoundingClientRect().width > 0) return c;
                    if (c.shadowRoot) { const f = findEditor(c.shadowRoot); if (f) return f; }
                  }
                  return null;
                }
                const editor = findEditor(document);
                if (editor) el = editor;
              }
              if (!el || el === document.body) return { ok: false, error: 'No editable element found' };
              el.focus?.();
              const target = el.shadowRoot?.querySelector('input, textarea') || el;
              if (target.isContentEditable) {
                target.focus();
                document.execCommand('selectAll', false, null);
                document.execCommand('delete', false, null);
                if (target.textContent?.trim()) target.innerHTML = '';
                const ok = document.execCommand('insertText', false, text);
                if (!ok) { target.textContent = ''; target.appendChild(document.createTextNode(text)); }
                target.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
                target.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
              } else {
                const tracker = target._valueTracker; if (tracker) tracker.setValue('');
                const proto = Object.getPrototypeOf(target);
                const desc = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
                if (desc?.set) desc.set.call(target, text); else target.value = text;
                target.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
                target.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
              }
              return { ok: true };
            },
            args: [cmd.text]
          });
          sendResult(cmd, result?.ok !== false, result, result?.error);
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      /* ── TypeChar (human-like character-by-character) ── */
      case 'typeChar': {
        const cdpOk = await canUseCDP(tabId);
        if (cdpOk) {
          const attached = await cdpAttach(tabId);
          if (attached) {
            if (!sessions.get(tabId)?.elementIndex) await refreshElementIndex(tabId);
            try {
              const result = await handleTypeChar(tabId, cmd.selector, cmd.text || cmd.char || '', cmd.delay || 80);
              sendResult(cmd, true, result);
              break;
            } catch (err) {
              console.error('CDP typeChar failed:', err.message);
            }
          }
        }
        // DOM fallback
        try {
          const tcLabel = resolveBackendNode(tabId, cmd.selector)?.name || '';
          await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (label, text, delay) => {
              return new Promise((resolve) => {
                function findInput(root, depth) {
                  if (depth > 8) return null;
                  for (const el of root.querySelectorAll('input, textarea, [contenteditable]')) {
                    const t = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim();
                    if (!label || t.toLowerCase().includes(label.toLowerCase())) return el;
                  }
                  for (const el of root.querySelectorAll('*')) {
                    if (el.shadowRoot) { const f = findInput(el.shadowRoot, depth + 1); if (f) return f; }
                  }
                  return null;
                }
                let el = findInput(document, 0) || document.activeElement;
                if (!el || el === document.body) { resolve({ ok: false }); return; }
                el.focus?.();
                const t = el.shadowRoot?.querySelector('input,textarea') || el;
                const isCE = t.isContentEditable;
                let i = 0;
                function next() {
                  if (i >= text.length) { t.dispatchEvent(new Event('change',{bubbles:true,composed:true})); resolve({ok:true}); return; }
                  const ch = text[i];
                  t.dispatchEvent(new KeyboardEvent('keydown',{key:ch,bubbles:true,composed:true}));
                  if(isCE) document.execCommand('insertText',false,ch); else { const tr=t._valueTracker; if(tr)tr.setValue(t.value); t.value+=ch; }
                  t.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,data:ch,inputType:'insertText'}));
                  t.dispatchEvent(new KeyboardEvent('keyup',{key:ch,bubbles:true,composed:true}));
                  i++; setTimeout(next, delay);
                }
                next();
              });
            },
            args: [tcLabel, cmd.text || cmd.char || '', cmd.delay || 80]
          });
          sendResult(cmd, true, {});
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      /* ── KeyPress ── */
      case 'keyPress': {
        const cdpOk = await canUseCDP(tabId);
        if (cdpOk) {
          const attached = await cdpAttach(tabId);
          if (attached) {
            try {
              const result = await handleKeypress(tabId, cmd.key);
              sendResult(cmd, true, result);
              break;
            } catch (err) {
              console.error('CDP keyPress failed:', err.message);
            }
          }
        }
        // DOM fallback
        try {
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (key) => {
              const map = { Enter:{key:'Enter',code:'Enter',kc:13}, Tab:{key:'Tab',code:'Tab',kc:9}, Escape:{key:'Escape',code:'Escape',kc:27},
                Backspace:{key:'Backspace',code:'Backspace',kc:8}, Delete:{key:'Delete',code:'Delete',kc:46}, Space:{key:' ',code:'Space',kc:32},
                ArrowUp:{key:'ArrowUp',code:'ArrowUp',kc:38}, ArrowDown:{key:'ArrowDown',code:'ArrowDown',kc:40},
                ArrowLeft:{key:'ArrowLeft',code:'ArrowLeft',kc:37}, ArrowRight:{key:'ArrowRight',code:'ArrowRight',kc:39} };
              const m = map[key] || { key, code: key, kc: 0 };
              let t = document.activeElement;
              while (t && t.shadowRoot && t.shadowRoot.activeElement) t = t.shadowRoot.activeElement;
              if (!t) t = document.body;
              const o = { key: m.key, code: m.code, keyCode: m.kc, bubbles: true, cancelable: true, composed: true };
              t.dispatchEvent(new KeyboardEvent('keydown', o));
              t.dispatchEvent(new KeyboardEvent('keypress', o));
              t.dispatchEvent(new KeyboardEvent('keyup', o));
              if (key === 'Enter') {
                if (t.form) { try { t.form.requestSubmit?.() || t.form.submit(); } catch {} }
                const form = t.closest?.('form') || t.getRootNode()?.querySelector?.('form');
                if (form) { try { form.requestSubmit?.() || form.submit(); } catch {} }
              }
              return { ok: true };
            },
            args: [cmd.key]
          });
          await settleDOM(tabId);
          sendResult(cmd, result?.ok !== false, result);
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      /* ── Select (native <select> element) ── */
      case 'select': {
        try {
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (sel, value) => {
              function deepFind(s) { let el = document.querySelector(s); if (el) return el; function search(root) { try { const f = root.querySelector(s); if (f) return f; } catch {} try { for (const c of root.querySelectorAll('*')) { if (c.shadowRoot) { const f = search(c.shadowRoot); if (f) return f; } } } catch {} return null; } return search(document); }
              const el = deepFind(sel);
              if (!el) return { ok: false, error: 'Not found: ' + sel };
              const t = el._valueTracker; if (t) t.setValue('');
              const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
              if (d?.set) d.set.call(el, value); else el.value = value;
              el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
              el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
              return { ok: true };
            },
            args: [cmd.selector, cmd.value]
          });
          await settleDOM(tabId);
          sendResult(cmd, result?.ok !== false, result, result?.error);
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      /* ── Hover ── */
      case 'hover': {
        const cdpOk = await canUseCDP(tabId);
        if (cdpOk) {
          const attached = await cdpAttach(tabId);
          if (attached) {
            if (!sessions.get(tabId)?.elementIndex) await refreshElementIndex(tabId);
            try {
              const result = await handleHover(tabId, cmd.selector);
              sendResult(cmd, true, result);
              break;
            } catch (err) {
              console.error('CDP hover failed:', err.message);
            }
          }
        }
        // DOM fallback — find by label, no getClickCoords dependency
        try {
          const hLabel = resolveBackendNode(tabId, cmd.selector)?.name || '';
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (label) => {
              function findByLabel(root, depth) {
                if (depth > 8) return null;
                for (const el of root.querySelectorAll('button, a, [role="button"], [aria-label]')) {
                  const text = (el.getAttribute('aria-label') || el.textContent || '').trim();
                  if (!label || text.toLowerCase().includes(label.toLowerCase())) return el;
                }
                for (const el of root.querySelectorAll('*')) {
                  if (el.shadowRoot) { const f = findByLabel(el.shadowRoot, depth + 1); if (f) return f; }
                }
                return null;
              }
              const el = findByLabel(document, 0);
              if (!el) return { ok: false, error: 'Not found' };
              el.scrollIntoView({ block: 'center', behavior: 'instant' });
              const r = el.getBoundingClientRect();
              const opts = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2, view: window };
              el.dispatchEvent(new PointerEvent('pointerover', opts));
              el.dispatchEvent(new MouseEvent('mouseover', opts));
              el.dispatchEvent(new MouseEvent('mousemove', opts));
              return { ok: true };
            },
            args: [hLabel]
          });
          sendResult(cmd, result?.ok !== false, result, result?.error);
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      /* ── Scroll ── */
      case 'scroll': {
        await ensureContentScript(tabId);
        try {
          const result = await sendToContent(tabId, { action: 'scroll', selector: cmd.selector, x: cmd.x || 0, y: cmd.y || cmd.amount || 300 });
          sendResult(cmd, result?.ok !== false, result, result?.error);
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      /* ── Element Snapshot (CDP AX tree) ── */
      case 'getPageInfo':
      case 'getElements': {
        const cdpOk = await canUseCDP(tabId);
        if (cdpOk) {
          const attached = await cdpAttach(tabId);
          if (attached) {
            try {
              await ensureContentScript(tabId);
              const data = await handleGetElements(tabId);
              sendResult(cmd, true, data);
              break;
            } catch (err) {
              console.error('CDP getElements failed, trying content script fallback:', err.message);
            }
          }
        }
        // Fallback to content script
        try {
          await ensureContentScript(tabId);
          const data = await sendToContent(tabId, { action: cmd.action });
          sendResult(cmd, true, data);
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      /* ── Attribute read ── */
      case 'getAttribute': {
        await ensureContentScript(tabId);
        try {
          const result = await sendToContent(tabId, { action: 'getAttribute', selector: cmd.selector, attribute: cmd.attribute });
          sendResult(cmd, result?.ok !== false, result, result?.error);
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      /* ── Wait for element ── */
      case 'waitForElement': {
        await ensureContentScript(tabId);
        try {
          const result = await sendToContent(tabId, { action: 'waitForElement', selector: cmd.selector, timeout: cmd.timeout || 10000 });
          sendResult(cmd, result?.ok !== false, result, result?.error);
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      /* ── Evaluate script in MAIN world ── */
      case 'evaluate': {
        try {
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (script) => { try { return { ok: true, value: eval(script) }; } catch (e) { return { ok: false, error: e.message }; } },
            args: [cmd.script]
          });
          sendResult(cmd, result.ok, result.ok ? result : null, result.error);
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      /* ── Screenshot ── */
      case 'screenshot': {
        try {
          const tab = await chrome.tabs.get(tabId);
          const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: SCREENSHOT_QUALITY });
          sendResult(cmd, true, { screenshot: dataUrl, url: tab.url, title: tab.title });
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      /* ── Tab management ── */
      case 'newTab': {
        if (cmd.url && cmd.url !== 'about:blank') {
          try {
            const requestedUrl = new URL(cmd.url);
            const allTabs = await chrome.tabs.query({});

            let existing = allTabs.find(t => {
              if (!t.url || isProtectedTab(t)) return false;
              try { const u = new URL(t.url); return u.hostname === requestedUrl.hostname && u.pathname === requestedUrl.pathname; }
              catch { return false; }
            });

            if (!existing) {
              existing = allTabs.find(t => {
                if (!t.url || isProtectedTab(t)) return false;
                try { return new URL(t.url).hostname === requestedUrl.hostname; }
                catch { return false; }
              });
            }

            if (existing) {
              await chrome.tabs.update(existing.id, { active: true });
              try { await chrome.windows.update(existing.windowId, { focused: true }); } catch {}
              try {
                const currentUrl = new URL(existing.url);
                const isSameUrl = currentUrl.hostname === requestedUrl.hostname && currentUrl.pathname === requestedUrl.pathname;
                if (!isSameUrl) { await chrome.tabs.update(existing.id, { url: cmd.url }); await waitForPageLoad(existing.id); }
              } catch { await chrome.tabs.update(existing.id, { url: cmd.url }); await waitForPageLoad(existing.id); }
              await ensureContentScript(existing.id);
              const tab = await chrome.tabs.get(existing.id);
              lastAgentTabId = tab.id;
              sendResult(cmd, true, { newTabId: tab.id, url: tab.url, title: tab.title, reused: true });
              break;
            }
          } catch {}
        }

        const newTab = await chrome.tabs.create({ url: cmd.url || 'about:blank', active: cmd.active !== false });
        if (cmd.url && cmd.url !== 'about:blank') { await waitForPageLoad(newTab.id); await ensureContentScript(newTab.id); }
        lastAgentTabId = newTab.id;
        sendResult(cmd, true, { newTabId: newTab.id, url: newTab.url, title: newTab.title });
        break;
      }

      case 'closeTab': {
        const closeId = cmd.tabId || tabId;
        cdpDetach(closeId);
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
        lastAgentTabId = switchId;
        sendResult(cmd, true, { tabId: switchId, url: tab.url, title: tab.title });
        break;
      }

      case 'getTabList': {
        const tabs = await chrome.tabs.query({});
        sendResult(cmd, true, { tabs: tabs.map(t => ({ tabId: t.id, url: t.url, title: t.title, active: t.active })) });
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

/* ════════════════════════════════════════════════════════
 *  POPUP MESSAGE HANDLER
 * ════════════════════════════════════════════════════════ */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.tab) return false;
  if (msg.type === 'connect')    { connect().then(() => sendResponse({ status, error: lastError })); return true; }
  if (msg.type === 'disconnect') { disconnect(); sendResponse({ status }); return false; }
  if (msg.type === 'getStatus')  { chrome.tabs.query({}).then((tabs) => sendResponse({ status, error: lastError, tabCount: tabs.length })); return true; }
  if (msg.type === 'getStreamingTab') { getStreamingTab().then((tab) => sendResponse(tab ? { tabId: tab.id, url: tab.url, title: tab.title } : null)); return true; }
  return false;
});
