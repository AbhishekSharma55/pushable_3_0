/**
 * background.js — Browser Agent v4 service worker
 *
 * ARCHITECTURE:
 * - Scanning/observation: content script (ISOLATED world) via chrome.tabs.sendMessage
 * - ALL interactions: MAIN world via chrome.scripting.executeScript
 *
 * This ensures events use the page's JS constructors (not isolated world's),
 * which is critical for Lit/React components like Reddit's shreddit-vote-button.
 */

/* ── Constants ── */
const RECONNECT_DELAY = 3000;
const FRAME_INTERVAL = 100;
const FRAME_QUALITY = 40;
const SCREENSHOT_QUALITY = 85;
const KEEPALIVE_MINUTES = 0.3;
const PAGE_LOAD_TIMEOUT = 15000;
const DOM_SETTLE_QUIET = 400;
const DOM_SETTLE_MAX = 5000;

/* ── State ── */
let ws = null;
let status = 'disconnected';
let lastError = '';
let userDisconnected = false;
let streamingTabId = null;
const sessions = new Map();

/* ── Popup blocker bypass ── */
// Sites open popups via window.open() which browsers block.
// We intercept these and open them as proper tabs instead.
chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  // This fires when a link/script tries to open a new window/tab
  // The extension's tabs permission ensures it's allowed
});

// Override window.open in MAIN world to use chrome.tabs.create instead
// This runs on every page load
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        // Only override if not already overridden
        if (window.__psh_popup_bypass) return;
        window.__psh_popup_bypass = true;
        const origOpen = window.open;
        window.open = function(url, target, features) {
          if (url) {
            // Try native first, fall back to navigation
            const w = origOpen.call(window, url, target, features);
            if (!w) {
              // Popup was blocked — navigate current window as fallback
              // The extension will handle opening it in a new tab
              window.dispatchEvent(new CustomEvent('__psh_blocked_popup', { detail: { url } }));
              window.location.href = url;
            }
            return w;
          }
          return origOpen.call(window, url, target, features);
        };
      }
    }).catch(() => {}); // Ignore errors on chrome:// pages
  }
});

/* ── Keepalive ── */
chrome.alarms.create('keepalive', { periodInMinutes: KEEPALIVE_MINUTES });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive' && !userDisconnected && status === 'disconnected') connect();
});
setInterval(() => {
  if (!userDisconnected && status === 'disconnected') connect();
}, 20000);

/* ── WebSocket ── */
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

  status = 'connecting';
  lastError = '';
  userDisconnected = false;

  try { ws = new WebSocket(url); } catch (err) { status = 'error'; lastError = err.message; return; }

  ws.onopen = async () => {
    status = 'connected';
    lastError = '';
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
    ws = null;
    stopFrameLoop();
    if (event.code >= 4000 && event.code < 5000) { status = 'error'; lastError = event.reason || `Auth failed (${event.code})`; return; }
    status = 'disconnected';
    if (!userDisconnected) setTimeout(connect, RECONNECT_DELAY);
  };

  ws.onerror = () => { status = 'error'; lastError = 'WebSocket error'; };
}

function disconnect() {
  userDisconnected = true;
  if (ws) { ws.close(1000, 'User disconnected'); ws = null; }
  status = 'disconnected';
  lastError = '';
  stopFrameLoop();
}

/* ── Tab events ── */
chrome.tabs.onCreated.addListener((tab) => send({ type: 'tabEvent', event: 'created', tabId: tab.id, url: tab.url || '', title: tab.title || '' }));
chrome.tabs.onRemoved.addListener((tabId) => { sessions.delete(tabId); send({ type: 'tabEvent', event: 'closed', tabId }); });
chrome.tabs.onUpdated.addListener((tabId, info, tab) => { if (info.url || info.title) send({ type: 'tabEvent', event: 'updated', tabId, url: tab.url, title: tab.title }); });

/* ── Frame streaming ── */
let frameTimer = null;
function startFrameLoop() { stopFrameLoop(); frameTimer = setInterval(captureFrame, FRAME_INTERVAL); }
function stopFrameLoop() { if (frameTimer) { clearInterval(frameTimer); frameTimer = null; } }
async function captureFrame() {
  try {
    const tab = await getStreamingTab();
    if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: FRAME_QUALITY });
    send({ type: 'frame', tabId: tab.id, url: tab.url, title: tab.title, data: dataUrl });
  } catch {}
}
async function getStreamingTab() {
  if (streamingTabId) { try { return await chrome.tabs.get(streamingTabId); } catch { streamingTabId = null; } }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/* ── Command queue ── */
function enqueue(cmd) {
  const tabFree = ['getTabList', 'newTab'];
  if (tabFree.includes(cmd.action)) { executeCommand(cmd, null); return; }
  if (!cmd.tabId) {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab) { cmd.tabId = tab.id; enqueueForTab(cmd); }
      else sendResult(cmd, false, null, 'No active tab');
    });
    return;
  }
  enqueueForTab(cmd);
}
function enqueueForTab(cmd) {
  const tabId = cmd.tabId;
  if (!sessions.has(tabId)) sessions.set(tabId, { queue: [], running: false });
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

/* ── Helpers ── */
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
      if (details.tabId === tabId && details.frameId === 0) { clearTimeout(timer); chrome.webNavigation.onCompleted.removeListener(listener); setTimeout(resolve, 500); }
    }
    chrome.webNavigation.onCompleted.addListener(listener);
  });
}
async function settleDOM(tabId) {
  try { await sendToContent(tabId, { action: 'waitForDOM', quietMs: DOM_SETTLE_QUIET, maxMs: DOM_SETTLE_MAX }); }
  catch { await new Promise(r => setTimeout(r, 800)); await ensureContentScript(tabId); }
}

/* ══════════════════════════════════════════════════════════════
 *  COMMAND EXECUTION
 *  All interactions use inline functions in chrome.scripting.executeScript
 *  because executeScript serializes ONLY the func body — it cannot
 *  reference external functions (deepFind, etc.)
 * ══════════════════════════════════════════════════════════════ */

async function executeCommand(cmd, tabId) {
  try {
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

      /* ── Interactions — ALL in MAIN world via coordinates ── */
      // Content script keeps element references in JS Map (no DOM attributes set).
      // We ask content script for coordinates, then click at those coords in MAIN world.
      // This avoids DOM mutations that close dropdowns/menus.
      case 'click': {
        await ensureContentScript(tabId);

        // Step 1: Content script resolves element from its Map and returns center coords
        let coords = null;
        try {
          coords = await sendToContent(tabId, { action: 'getClickCoords', selector: cmd.selector });
        } catch {}

        if (!coords || coords.x === null || coords.y === null) {
          sendResult(cmd, false, null, 'Element not found: ' + cmd.selector);
          break;
        }

        try {
          // Step 2: Click at coordinates in MAIN world
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (cx, cy) => {
              // Content script already scrolled the element into view.
              // elementFromPoint returns the deepest element at viewport coords.
              const el = document.elementFromPoint(cx, cy);
              if (!el) return { ok: false, error: 'No element at (' + cx + ',' + cy + ')' };

              // Full pointer+mouse event sequence with composed:true (crosses shadow DOM)
              const opts = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy, screenX: cx, screenY: cy, button: 0, buttons: 1, view: window };
              el.dispatchEvent(new PointerEvent('pointerover', opts));
              el.dispatchEvent(new PointerEvent('pointerenter', { ...opts, bubbles: false }));
              el.dispatchEvent(new MouseEvent('mouseover', opts));
              el.dispatchEvent(new MouseEvent('mouseenter', { ...opts, bubbles: false }));
              el.dispatchEvent(new MouseEvent('mousemove', opts));
              el.dispatchEvent(new PointerEvent('pointerdown', opts));
              el.dispatchEvent(new MouseEvent('mousedown', opts));
              el.focus?.();
              el.dispatchEvent(new PointerEvent('pointerup', opts));
              el.dispatchEvent(new MouseEvent('mouseup', opts));
              el.dispatchEvent(new MouseEvent('click', opts));
              return { ok: true, tag: el.tagName.toLowerCase() };
            },
            args: [coords.x, coords.y]
          });
          // No settleDOM here — it closes dropdowns/menus by observing mutations too long.
          // The next get_elements() call has its own quickSettle (150ms).
          sendResult(cmd, result?.ok !== false, result, result?.error);
        } catch (err) {
          sendResult(cmd, false, null, err.message);
        }
        break;
      }

      case 'clickPoint': {
        try {
          const result = await executeInMainWorld(tabId, (nx, ny) => {
            const px = Math.round(nx * window.innerWidth), py = Math.round(ny * window.innerHeight);
            const el = document.elementFromPoint(px, py);
            if (!el) return { ok: false, error: `No element at (${px},${py})` };
            el.click();
            return { ok: true, x: px, y: py, tag: el.tagName.toLowerCase() };
          }, [cmd.x, cmd.y]);
          await settleDOM(tabId);
          sendResult(cmd, result?.ok !== false, result, result?.error);
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      case 'type': {
        await ensureContentScript(tabId);

        // Step 1: Get coordinates from content script
        let typeCoords = null;
        try {
          typeCoords = await sendToContent(tabId, { action: 'getClickCoords', selector: cmd.selector });
        } catch {}

        try {
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (cx, cy, text) => {
              let el = null;
              if (cx !== null && cy !== null) el = document.elementFromPoint(cx, cy);
              if (!el) el = document.activeElement;
              if (!el || el === document.body) return { ok: false, error: 'No element at coordinates' };
              el.scrollIntoView({ block: 'center', behavior: 'instant' });
              el.focus?.();
              // If not editable, click to open editor, find real target
              if (!el.isContentEditable && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
                el.click();
                const active = document.activeElement;
                if (active && active !== document.body && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
                  el = active;
                } else {
                  for (const host of document.querySelectorAll('*')) {
                    if (host.shadowRoot) {
                      const inner = host.shadowRoot.querySelector('[contenteditable="true"], textarea, input:not([type=hidden])');
                      if (inner && inner.getBoundingClientRect().width > 0) { el = inner; break; }
                    }
                  }
                }
                el.focus?.();
              }
              const target = el.shadowRoot?.querySelector('input, textarea') || el;
              if (target.isContentEditable) {
                const s = window.getSelection(); const r = document.createRange();
                r.selectNodeContents(target); s.removeAllRanges(); s.addRange(r);
                if (target.textContent) document.execCommand('delete', false, null);
                const ok = document.execCommand('insertText', false, text);
                if (!ok) { target.textContent = ''; target.appendChild(document.createTextNode(text)); }
                target.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
                target.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
              } else {
                const tracker = target._valueTracker; if (tracker) tracker.setValue('');
                const proto = Object.getPrototypeOf(target);
                const desc = Object.getOwnPropertyDescriptor(proto, 'value') ||
                  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
                  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
                if (desc?.set) desc.set.call(target, text); else target.value = text;
                target.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
                target.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
              }
              return { ok: true };
            },
            args: [typeCoords?.x ?? null, typeCoords?.y ?? null, cmd.text]
          });
          await settleDOM(tabId);
          sendResult(cmd, result?.ok !== false, result, result?.error);
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      case 'typeChar': {
        await ensureContentScript(tabId);
        let tcCoords = null;
        try { tcCoords = await sendToContent(tabId, { action: 'getClickCoords', selector: cmd.selector }); } catch {}
        try {
          await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (cx, cy, text, delay) => {
              return new Promise((resolve) => {
                let el = null;
                if (cx !== null && cy !== null) el = document.elementFromPoint(cx, cy);
                if (!el) el = document.activeElement;
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
            args: [tcCoords?.x ?? null, tcCoords?.y ?? null, cmd.text, cmd.delay || 80]
          });
          await settleDOM(tabId);
          sendResult(cmd, true, {});
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      case 'keyPress': {
        try {
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (key) => {
              const map = { Enter:{key:'Enter',code:'Enter',kc:13}, Tab:{key:'Tab',code:'Tab',kc:9}, Escape:{key:'Escape',code:'Escape',kc:27},
                Backspace:{key:'Backspace',code:'Backspace',kc:8}, Delete:{key:'Delete',code:'Delete',kc:46}, Space:{key:' ',code:'Space',kc:32},
                ArrowUp:{key:'ArrowUp',code:'ArrowUp',kc:38}, ArrowDown:{key:'ArrowDown',code:'ArrowDown',kc:40},
                ArrowLeft:{key:'ArrowLeft',code:'ArrowLeft',kc:37}, ArrowRight:{key:'ArrowRight',code:'ArrowRight',kc:39} };
              const m = map[key] || { key, code: key, kc: 0 };
              const t = document.activeElement || document.body;
              const o = { key: m.key, code: m.code, keyCode: m.kc, bubbles: true, cancelable: true, composed: true };
              t.dispatchEvent(new KeyboardEvent('keydown', o));
              t.dispatchEvent(new KeyboardEvent('keypress', o));
              t.dispatchEvent(new KeyboardEvent('keyup', o));
              if (key === 'Enter' && t.form) { try { t.form.requestSubmit?.() || t.form.submit(); } catch {} }
              return { ok: true };
            },
            args: [cmd.key]
          });
          await settleDOM(tabId);
          sendResult(cmd, result?.ok !== false, result);
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

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

      case 'hover': {
        await ensureContentScript(tabId);
        let hCoords = null;
        try { hCoords = await sendToContent(tabId, { action: 'getClickCoords', selector: cmd.selector }); } catch {}
        try {
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (cx, cy) => {
              const el = cx !== null ? document.elementFromPoint(cx, cy) : null;
              if (!el) return { ok: false, error: 'Not found' };
              el.scrollIntoView({ block: 'center', behavior: 'instant' });
              const r = el.getBoundingClientRect();
              const opts = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2, view: window };
              el.dispatchEvent(new PointerEvent('pointerover', opts));
              el.dispatchEvent(new MouseEvent('mouseover', opts));
              el.dispatchEvent(new MouseEvent('mousemove', opts));
              return { ok: true };
            },
            args: [hCoords?.x ?? null, hCoords?.y ?? null]
          });
          sendResult(cmd, result?.ok !== false, result, result?.error);
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      case 'scroll': {
        await ensureContentScript(tabId);
        const result = await sendToContent(tabId, { action: 'scroll', selector: cmd.selector, x: cmd.x || 0, y: cmd.y || 0 });
        sendResult(cmd, result?.ok !== false, result, result?.error);
        break;
      }

      /* ── Observation — via content script ── */
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
        sendResult(cmd, result?.ok !== false, result, result?.error);
        break;
      }

      case 'waitForElement': {
        await ensureContentScript(tabId);
        const result = await sendToContent(tabId, { action: 'waitForElement', selector: cmd.selector, timeout: cmd.timeout || 10000 });
        sendResult(cmd, result?.ok !== false, result, result?.error);
        break;
      }

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

      /* ── Tab management — aggressive tab reuse ── */
      // The agent tends to open many tabs for the same task. We enforce:
      // 1. If ANY tab on the same domain is open, reuse it (navigate, don't create new)
      // 2. If the exact URL is already open, just switch to it
      case 'newTab': {
        if (cmd.url && cmd.url !== 'about:blank') {
          try {
            const requestedUrl = new URL(cmd.url);
            const allTabs = await chrome.tabs.query({});

            // First: exact URL match (hostname + pathname)
            let existing = allTabs.find(t => {
              if (!t.url) return false;
              try {
                const u = new URL(t.url);
                return u.hostname === requestedUrl.hostname && u.pathname === requestedUrl.pathname;
              } catch { return false; }
            });

            // Second: same domain match — reuse by navigating
            if (!existing) {
              existing = allTabs.find(t => {
                if (!t.url) return false;
                try { return new URL(t.url).hostname === requestedUrl.hostname; }
                catch { return false; }
              });
            }

            if (existing) {
              await chrome.tabs.update(existing.id, { active: true });
              try { await chrome.windows.update(existing.windowId, { focused: true }); } catch {}
              // Navigate if URL is different
              try {
                const currentUrl = new URL(existing.url);
                const isSameUrl = currentUrl.hostname === requestedUrl.hostname && currentUrl.pathname === requestedUrl.pathname;
                if (!isSameUrl) {
                  await chrome.tabs.update(existing.id, { url: cmd.url });
                  await waitForPageLoad(existing.id);
                }
              } catch {
                await chrome.tabs.update(existing.id, { url: cmd.url });
                await waitForPageLoad(existing.id);
              }
              await ensureContentScript(existing.id);
              const tab = await chrome.tabs.get(existing.id);
              sendResult(cmd, true, { newTabId: tab.id, url: tab.url, title: tab.title, reused: true });
              break;
            }
          } catch {} // URL parse failed — fall through to create
        }

        // No existing tab on this domain — create new one
        const newTab = await chrome.tabs.create({ url: cmd.url || 'about:blank', active: cmd.active !== false });
        if (cmd.url && cmd.url !== 'about:blank') { await waitForPageLoad(newTab.id); await ensureContentScript(newTab.id); }
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

/* ── Popup message handler ── */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.tab) return false;
  if (msg.type === 'connect') { connect().then(() => sendResponse({ status, error: lastError })); return true; }
  if (msg.type === 'disconnect') { disconnect(); sendResponse({ status }); return false; }
  if (msg.type === 'getStatus') { chrome.tabs.query({}).then((tabs) => sendResponse({ status, error: lastError, tabCount: tabs.length })); return true; }
  if (msg.type === 'getStreamingTab') { getStreamingTab().then((tab) => sendResponse(tab ? { tabId: tab.id, url: tab.url, title: tab.title } : null)); return true; }
});
