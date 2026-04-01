/**
 * background.js — Browser Agent v6 (Python CDP Analyzer)
 *
 * ARCHITECTURE:
 * 1. Extension attaches chrome.debugger to tab
 * 2. Collects raw CDP data: DOMSnapshot.captureSnapshot + Accessibility.getFullAXTree
 * 3. Sends raw data to Python analyzer (localhost:5050/process) for heavy processing
 * 4. Python returns clean element list with coordinates + backendNodeIds
 * 5. Extension clicks/types via CDP Input.dispatchMouseEvent (isTrusted:true)
 *
 * User setup: just install extension. Python runs on server Docker. No --remote-debugging needed.
 */

/* ── Constants ── */
const RECONNECT_DELAY = 3000;
const FRAME_INTERVAL = 100;
const FRAME_QUALITY = 40;
const SCREENSHOT_QUALITY = 85;
const KEEPALIVE_MINUTES = 0.3;
const PAGE_LOAD_TIMEOUT = 15000;
const CDP_VERSION = '1.3';
// CDP Analyzer URL — routes through the backend API proxy
// In dev: backend is localhost:4000, in prod: api.pushable.ai
// The extension derives this from the stored serverUrl (ws://localhost:3004 → http://localhost:4000)
let ANALYZER_BASE_URL = 'http://localhost:4000/api/cdp-analyzer';

async function getAnalyzerUrl() {
  try {
    const data = await chrome.storage.local.get(['serverUrl']);
    const wsUrl = data.serverUrl || '';
    // Derive backend API URL from the extension bridge WebSocket URL
    // ws://localhost:3004 → http://localhost:4000
    // wss://ws.pushable.ai → https://api.pushable.ai
    if (wsUrl.includes('pushable.ai')) {
      ANALYZER_BASE_URL = 'https://api.pushable.ai/api/cdp-analyzer';
    } else if (wsUrl.includes('localhost')) {
      ANALYZER_BASE_URL = 'http://localhost:4000/api/cdp-analyzer';
    }
  } catch {}
  return ANALYZER_BASE_URL;
}

// Initialize on load
getAnalyzerUrl();

/* ── State ── */
let ws = null;
let status = 'disconnected';
let lastError = '';
let userDisconnected = false;
let streamingTabId = null;
let lastAgentTabId = null;
const sessions = new Map(); // tabId → { queue, running, elementCache }

/* ── CDP State ── */
const cdpAttached = new Set();
const cdpAttaching = new Map();

/* ══════════════════════════════════════════════════════════
 *  CDP SESSION — attach/detach/send
 * ══════════════════════════════════════════════════════════ */

async function cdpAttach(tabId) {
  if (cdpAttached.has(tabId)) return true;
  if (cdpAttaching.has(tabId)) return cdpAttaching.get(tabId);
  const p = new Promise(resolve => {
    chrome.debugger.attach({ tabId }, CDP_VERSION, () => {
      cdpAttaching.delete(tabId);
      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message || '';
        if (msg.includes('Another debugger') || msg.includes('already attached')) { cdpAttached.add(tabId); resolve(true); }
        else resolve(false);
        return;
      }
      cdpAttached.add(tabId); resolve(true);
    });
  });
  cdpAttaching.set(tabId, p);
  return p;
}

function cdpDetach(tabId) {
  if (!cdpAttached.has(tabId)) return;
  chrome.debugger.detach({ tabId }, () => { chrome.runtime.lastError; });
  cdpAttached.delete(tabId);
}

function cdpSend(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, result => {
      if (chrome.runtime.lastError) {
        reject(new Error(`CDP ${method}: ${chrome.runtime.lastError.message}`));
        return;
      }
      resolve(result || {});
    });
  });
}

chrome.debugger.onDetach.addListener((source) => { cdpAttached.delete(source.tabId); });

/* ══════════════════════════════════════════════════════════
 *  CORE: Collect raw CDP data → send to Python → get elements
 * ══════════════════════════════════════════════════════════ */

async function collectAndAnalyze(tabId) {
  const attached = await cdpAttach(tabId);
  if (!attached) throw new Error('Cannot attach debugger to this tab');

  // Enable required domains
  await cdpSend(tabId, 'Accessibility.enable', {}).catch(() => {});

  // Collect raw CDP data in parallel
  const [snapshot, axTree] = await Promise.all([
    cdpSend(tabId, 'DOMSnapshot.captureSnapshot', {
      computedStyles: ['display', 'visibility', 'opacity', 'cursor', 'pointer-events', 'position'],
      includePaintOrder: true,
      includeDOMRects: true,
    }),
    cdpSend(tabId, 'Accessibility.getFullAXTree', {}),
  ]);

  // Get page info
  const tab = await chrome.tabs.get(tabId);

  // Send to Python analyzer for processing
  const resp = await fetch(`${ANALYZER_BASE_URL}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      snapshot,
      ax_tree: axTree,
      url: tab.url || '',
      title: tab.title || '',
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(`Analyzer error: ${err.detail || resp.status}`);
  }

  const result = await resp.json();

  // Cache elements for this tab
  if (!sessions.has(tabId)) sessions.set(tabId, { queue: [], running: false, elementCache: null });
  sessions.get(tabId).elementCache = result.elements;

  return result;
}

/** Find overflow button near text using Python analyzer */
async function findOverflow(tabId, nearText, menuAction) {
  const attached = await cdpAttach(tabId);
  if (!attached) throw new Error('Cannot attach debugger');

  await cdpSend(tabId, 'Accessibility.enable', {}).catch(() => {});

  const [snapshot, axTree] = await Promise.all([
    cdpSend(tabId, 'DOMSnapshot.captureSnapshot', {
      computedStyles: ['display', 'visibility', 'opacity', 'cursor', 'pointer-events', 'position'],
      includePaintOrder: true, includeDOMRects: true,
    }),
    cdpSend(tabId, 'Accessibility.getFullAXTree', {}),
  ]);

  const tab = await chrome.tabs.get(tabId);

  const resp = await fetch(`${ANALYZER_BASE_URL}/find-overflow?near_text=${encodeURIComponent(nearText)}&menu_action=${encodeURIComponent(menuAction)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshot, ax_tree: axTree, url: tab.url || '', title: tab.title || '' }),
  });

  if (!resp.ok) throw new Error(`Analyzer error: ${resp.status}`);
  return resp.json();
}

/* ══════════════════════════════════════════════════════════
 *  CDP Actions — click, type (all trusted via chrome.debugger)
 * ══════════════════════════════════════════════════════════ */

async function cdpClick(tabId, x, y) {
  await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await new Promise(r => setTimeout(r, 50));
  await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await new Promise(r => setTimeout(r, 80));
  await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

/** Scroll element into view, get VIEWPORT coordinates, then CDP click. */
async function scrollAndClick(tabId, backendNodeId, fallbackX, fallbackY) {
  let x = fallbackX, y = fallbackY;
  if (backendNodeId) {
    try { await cdpSend(tabId, 'DOM.scrollIntoViewIfNeeded', { backendNodeId }); } catch {}
    await new Promise(r => setTimeout(r, 200));
    try {
      const quads = await cdpSend(tabId, 'DOM.getContentQuads', { backendNodeId });
      if (quads.quads?.[0]?.length >= 8) {
        const q = quads.quads[0];
        x = (q[0] + q[2] + q[4] + q[6]) / 4;
        y = (q[1] + q[3] + q[5] + q[7]) / 4;
      }
    } catch {}
  }
  await cdpClick(tabId, x, y);
}

async function cdpTypeText(tabId, text) {
  const SHIFT = {'!':'1','@':'2','#':'3','$':'4','%':'5','^':'6','&':'7','*':'8','(':'9',')':'0','_':'-','+':'=','{':'[','}':']','|':'\\',':':';','"':"'",'<':',','>':'.','?':'/','~':'`'};
  for (const char of text) {
    if (char === '\n') {
      await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'char', text: '\r', key: 'Enter' });
      await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter' });
    } else {
      let mods = 0, base = char, code = '';
      if (SHIFT[char]) { mods = 8; base = SHIFT[char]; }
      else if (char >= 'A' && char <= 'Z') { mods = 8; base = char.toLowerCase(); }
      if (base >= 'a' && base <= 'z') code = 'Key' + base.toUpperCase();
      else if (base >= '0' && base <= '9') code = 'Digit' + base;
      await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: base, code, modifiers: mods, windowsVirtualKeyCode: base.charCodeAt(0) });
      await new Promise(r => setTimeout(r, 5));
      await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'char', text: char, key: char });
      await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: base, code, modifiers: mods });
    }
    await new Promise(r => setTimeout(r, 1));
  }
}

async function cdpFocusAndType(tabId, text, backendNodeId, x, y) {
  if (backendNodeId) {
    try { await cdpSend(tabId, 'DOM.focus', { backendNodeId }); } catch {
      if (x && y) await cdpClick(tabId, x, y);
    }
  } else if (x && y) {
    await cdpClick(tabId, x, y);
  }
  await new Promise(r => setTimeout(r, 300));

  // Clear: Ctrl+A → Backspace
  await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2 });
  await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace' });
  await new Promise(r => setTimeout(r, 50));

  // Try insertText first
  await cdpSend(tabId, 'Input.insertText', { text });
  await new Promise(r => setTimeout(r, 200));

  // Verify via Runtime.evaluate
  try {
    const { result } = await cdpSend(tabId, 'Runtime.evaluate', {
      expression: `(() => { let e=document.activeElement; while(e&&e.shadowRoot&&e.shadowRoot.activeElement)e=e.shadowRoot.activeElement; return e?(e.isContentEditable?(e.innerText||'').trim():(e.value||'').trim()):''; })()`,
      returnByValue: true,
    });
    if (!result?.value) {
      // Fallback: char by char
      await cdpTypeText(tabId, text);
    }
  } catch {
    await cdpTypeText(tabId, text);
  }
}

/* ══════════════════════════════════════════════════════════
 *  WebSocket / Connection / Keepalive (same as v3)
 * ══════════════════════════════════════════════════════════ */

chrome.alarms.create('keepalive', { periodInMinutes: KEEPALIVE_MINUTES });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'keepalive' && !userDisconnected && status === 'disconnected') connect(); });
setInterval(() => { if (!userDisconnected && status === 'disconnected') connect(); }, 20000);

async function getWsUrl() {
  const data = await chrome.storage.local.get(['serverUrl', 'apiKey']);
  if (!data.serverUrl) return null;
  const key = data.apiKey || '';
  return key ? `${data.serverUrl}?key=${encodeURIComponent(key)}` : data.serverUrl;
}

function send(obj) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }

async function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const url = await getWsUrl();
  if (!url) { status = 'error'; lastError = 'No server URL'; return; }
  await getAnalyzerUrl(); // Refresh analyzer URL based on current server config
  status = 'connecting'; lastError = ''; userDisconnected = false;
  try { ws = new WebSocket(url); } catch (err) { status = 'error'; lastError = err.message; return; }
  ws.onopen = async () => {
    status = 'connected'; lastError = '';
    const tabs = await chrome.tabs.query({});
    send({ type: 'status', status: 'connected', tabs: tabs.map(t => ({ tabId: t.id, url: t.url, title: t.title })) });
    startFrameLoop();
  };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } if (m.type === 'ping') { send({ type: 'pong' }); return; } if (m.commandId && m.action) enqueue(m); };
  ws.onclose = e => { ws = null; stopFrameLoop(); if (e.code >= 4000) { status = 'error'; lastError = e.reason || 'Auth failed'; return; } status = 'disconnected'; if (!userDisconnected) setTimeout(connect, RECONNECT_DELAY); };
  ws.onerror = () => { status = 'error'; lastError = 'WebSocket error'; };
}

function disconnect() { userDisconnected = true; if (ws) { ws.close(1000); ws = null; } status = 'disconnected'; lastError = ''; stopFrameLoop(); }

/* ── Tab Events ── */
chrome.tabs.onCreated.addListener(t => send({ type: 'tabEvent', event: 'created', tabId: t.id, url: t.url || '', title: t.title || '' }));
chrome.tabs.onRemoved.addListener(id => { sessions.delete(id); cdpDetach(id); send({ type: 'tabEvent', event: 'closed', tabId: id }); });
chrome.tabs.onUpdated.addListener((id, info, tab) => { if (info.url || info.title) send({ type: 'tabEvent', event: 'updated', tabId: id, url: tab.url, title: tab.title }); });

/* ── Frame Streaming ── */
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

/* ── Command Queue ── */
function isProtectedTab(tab) {
  if (!tab?.url) return false;
  const u = tab.url;
  if (u.startsWith('chrome://') || u.startsWith('chrome-extension://') || u.startsWith('about:')) return true;
  try { const h = new URL(u).hostname; if (h === 'localhost' && ['3000','3001','3002'].includes(new URL(u).port)) return true; if (h.endsWith('pushable.ai') || h.includes('pushable')) return true; } catch {}
  return false;
}

function enqueue(cmd) {
  if (['getTabList','newTab'].includes(cmd.action)) { executeCommand(cmd, null); return; }
  if (!cmd.tabId) {
    if (lastAgentTabId) { chrome.tabs.get(lastAgentTabId, tab => { if (chrome.runtime.lastError || !tab) { lastAgentTabId = null; sendResult(cmd, false, null, 'No tab open'); } else { cmd.tabId = lastAgentTabId; enqueueForTab(cmd); } }); }
    else { chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => { if (tab && !isProtectedTab(tab)) { cmd.tabId = tab.id; enqueueForTab(cmd); } else sendResult(cmd, false, null, 'No tab open'); }); }
    return;
  }
  enqueueForTab(cmd);
}

function enqueueForTab(cmd) {
  if (!sessions.has(cmd.tabId)) sessions.set(cmd.tabId, { queue: [], running: false, elementCache: null });
  sessions.get(cmd.tabId).queue.push(cmd);
  drainQueue(cmd.tabId);
}

async function drainQueue(tabId) {
  const s = sessions.get(tabId);
  if (!s || s.running) return;
  s.running = true;
  while (s.queue.length > 0) await executeCommand(s.queue.shift(), tabId);
  s.running = false;
}

function sendResult(cmd, success, data, error) {
  send({ type: 'result', commandId: cmd.commandId, tabId: cmd.tabId || null, success, action: cmd.action, ...(success ? { data } : { error: error || 'Unknown error' }) });
}

function waitForPageLoad(tabId, timeout = PAGE_LOAD_TIMEOUT) {
  return new Promise(resolve => {
    const timer = setTimeout(() => { chrome.webNavigation.onCompleted.removeListener(listener); resolve(); }, timeout);
    function listener(d) { if (d.tabId === tabId && d.frameId === 0) { clearTimeout(timer); chrome.webNavigation.onCompleted.removeListener(listener); setTimeout(resolve, 500); } }
    chrome.webNavigation.onCompleted.addListener(listener);
  });
}

async function ensureContentScript(tabId) {
  try { await chrome.tabs.sendMessage(tabId, { action: 'ping' }); return true; }
  catch { try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); await new Promise(r => setTimeout(r, 200)); return true; } catch { return false; } }
}

/* ══════════════════════════════════════════════════════════
 *  COMMAND EXECUTION
 * ══════════════════════════════════════════════════════════ */

async function executeCommand(cmd, tabId) {
  try {
    if (tabId && !['getTabList','newTab'].includes(cmd.action)) lastAgentTabId = tabId;

    switch (cmd.action) {

      // ── Navigation ──
      case 'navigate': {
        let url = cmd.url;
        if (url && !url.startsWith('http') && !url.startsWith('file:')) url = 'https://' + url;

        // Check if already on this URL or same page — skip reload
        if (tabId) {
          try {
            const currentTab = await chrome.tabs.get(tabId);
            if (isProtectedTab(currentTab)) {
              const nt = await chrome.tabs.create({ url, active: true });
              await waitForPageLoad(nt.id); lastAgentTabId = nt.id;
              const t2 = await chrome.tabs.get(nt.id);
              sendResult(cmd, true, { url: t2.url, title: t2.title, newTabId: nt.id }); break;
            }
            // Already on this exact URL or same page? Don't reload.
            try {
              const currentUrl = new URL(currentTab.url);
              const targetUrl = new URL(url);
              if (currentUrl.hostname === targetUrl.hostname && currentUrl.pathname === targetUrl.pathname) {
                sendResult(cmd, true, { url: currentTab.url, title: currentTab.title, skippedReload: true });
                break;
              }
            } catch {}
          } catch {}
        }

        // Also check ALL tabs — maybe another tab already has this URL
        try {
          const allTabs = await chrome.tabs.query({});
          const targetHost = new URL(url).hostname;
          const targetPath = new URL(url).pathname;
          const existing = allTabs.find(t => {
            if (!t.url || isProtectedTab(t)) return false;
            try {
              const u = new URL(t.url);
              return u.hostname === targetHost && u.pathname === targetPath;
            } catch { return false; }
          });
          if (existing) {
            await chrome.tabs.update(existing.id, { active: true });
            lastAgentTabId = existing.id; streamingTabId = existing.id;
            sendResult(cmd, true, { url: existing.url, title: existing.title, reusedTab: true });
            break;
          }
        } catch {}

        await chrome.tabs.update(tabId, { url }); await waitForPageLoad(tabId); await ensureContentScript(tabId);
        const tab = await chrome.tabs.get(tabId); sendResult(cmd, true, { url: tab.url, title: tab.title }); break;
      }

      case 'reload': { await chrome.tabs.reload(tabId); await waitForPageLoad(tabId); sendResult(cmd, true, {}); break; }
      case 'goBack': { await chrome.scripting.executeScript({ target: { tabId }, func: () => history.back() }); await waitForPageLoad(tabId).catch(() => {}); sendResult(cmd, true, {}); break; }

      // ── Elements (Python Analyzer) ──
      case 'getElements':
      case 'getPageInfo': {
        try {
          const result = await collectAndAnalyze(tabId);
          sendResult(cmd, true, { snapshot: result.snapshot });
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      // ── Click by selector (CDP trusted) ──
      case 'click': {
        try {
          const result = await collectAndAnalyze(tabId);
          const m = String(cmd.selector).trim().match(/\[?(\d+)\]?/);
          if (!m) { sendResult(cmd, false, null, `Bad selector: ${cmd.selector}`); break; }
          const el = result.elements.find(e => e.id === parseInt(m[1]));
          if (!el) { sendResult(cmd, false, null, `Element [${m[1]}] not found`); break; }
          await scrollAndClick(tabId, el.backend_node_id, el.x + el.w / 2, el.y + el.h / 2);
          sendResult(cmd, true, { ok: true, clicked: el.name, tag: el.tag }); break;
        } catch (err) { sendResult(cmd, false, null, err.message); break; }
      }

      // ── Click by text (CDP trusted) ──
      case 'clickText': {
        try {
          const result = await collectAndAnalyze(tabId);
          const search = (cmd.text || '').toLowerCase();
          const matches = result.elements.filter(e => e.name.toLowerCase().includes(search));
          if (!matches.length) { sendResult(cmd, false, null, `No element containing "${cmd.text}"`); break; }
          // Score: links > buttons, shorter = better, exact match bonus
          matches.sort((a, b) => {
            let sa = 0, sb = 0;
            if (a.tag === 'a') sa += 20; if (b.tag === 'a') sb += 20;
            if (a.tag === 'button') sa += 10; if (b.tag === 'button') sb += 10;
            // Submit button detection
            if (['send','comment','post','submit','delete','confirm','yes','ok'].includes(search)) {
              if (a.h < 50 && a.w < 200) sa += 15; if (b.h < 50 && b.w < 200) sb += 15;
              sa += Math.floor(a.y / 50); sb += Math.floor(b.y / 50); // lower on page = submit
            }
            sa += Math.max(0, 10 - a.name.length / 10); sb += Math.max(0, 10 - b.name.length / 10);
            if (a.name.toLowerCase() === search) sa += 15; if (b.name.toLowerCase() === search) sb += 15;
            return sb - sa;
          });
          const best = matches[0];
          await scrollAndClick(tabId, best.backend_node_id, best.x + best.w / 2, best.y + best.h / 2);
          sendResult(cmd, true, { ok: true, clicked: best.name, tag: best.tag }); break;
        } catch (err) { sendResult(cmd, false, null, err.message); break; }
      }

      // ── Type (CDP trusted) ──
      case 'type': {
        try {
          const result = await collectAndAnalyze(tabId);
          const m = String(cmd.selector).trim().match(/\[?(\d+)\]?/);
          let bid = null, ex = null, ey = null;
          if (m) { const el = result.elements.find(e => e.id === parseInt(m[1])); if (el) { bid = el.backend_node_id; ex = el.x + el.w / 2; ey = el.y + el.h / 2; } }
          await cdpFocusAndType(tabId, cmd.text, bid, ex, ey);
          sendResult(cmd, true, { ok: true }); break;
        } catch (err) { sendResult(cmd, false, null, err.message); break; }
      }

      // ── Type into editor ──
      case 'typeIntoEditor': {
        try {
          const result = await collectAndAnalyze(tabId);
          const hint = (cmd.placeholder || 'Join the conversation').toLowerCase();
          // Find editor or placeholder
          let target = result.elements.find(e => e.name.toLowerCase().includes(hint) || (e.attributes?.placeholder || '').toLowerCase().includes(hint) || e.states?.includes('editable'));
          if (!target) target = result.elements.find(e => e.tag === 'textarea' || e.states?.includes('editable'));
          if (target) {
            await cdpClick(tabId, target.x + target.w / 2, target.y + target.h / 2);
            await new Promise(r => setTimeout(r, 1200));
          }
          // Re-analyze for editor
          const result2 = await collectAndAnalyze(tabId);
          let editor = result2.elements.find(e => e.states?.includes('editable') || e.tag === 'textarea');
          if (!editor) editor = result2.elements.find(e => e.role === 'textbox' || e.role === 'textBox');
          if (editor) { await cdpFocusAndType(tabId, cmd.text, editor.backend_node_id, editor.x + editor.w / 2, editor.y + editor.h / 2); }
          else { await cdpSend(tabId, 'Input.insertText', { text: cmd.text }); }
          sendResult(cmd, true, { ok: true, typed: cmd.text }); break;
        } catch (err) { sendResult(cmd, false, null, err.message); break; }
      }

      // ── Overflow menu (full flow via Python + CDP) ──
      case 'clickOverflowMenu': {
        try {
          // Step 1: Find overflow button via Python
          const overflow = await findOverflow(tabId, cmd.nearText || '', cmd.menuAction || '');
          if (!overflow.ok) { sendResult(cmd, false, null, overflow.error); break; }

          // Step 2: Scroll to the button and get VIEWPORT coordinates
          const bid = overflow.button.backend_node_id;
          if (bid) {
            try { await cdpSend(tabId, 'DOM.scrollIntoViewIfNeeded', { backendNodeId: bid }); } catch {}
            await new Promise(r => setTimeout(r, 300));
          }
          // Re-get viewport coords after scroll
          let clickX = overflow.button.x, clickY = overflow.button.y;
          if (bid) {
            try {
              const quads = await cdpSend(tabId, 'DOM.getContentQuads', { backendNodeId: bid });
              if (quads.quads?.[0]?.length >= 8) {
                const q = quads.quads[0];
                clickX = (q[0] + q[2] + q[4] + q[6]) / 4;
                clickY = (q[1] + q[3] + q[5] + q[7]) / 4;
              }
            } catch {}
          }

          // Step 3: CDP click the overflow button (trusted)
          await cdpClick(tabId, clickX, clickY);
          await new Promise(r => setTimeout(r, 1500));

          // Step 4: Re-analyze to find menu items (retry up to 3 times)
          const menuAction = (cmd.menuAction || '').toLowerCase();
          let menuItems = [];
          for (let attempt = 0; attempt < 3; attempt++) {
            const result2 = await collectAndAnalyze(tabId);
            menuItems = result2.elements.filter(e =>
              e.name.toLowerCase().includes(menuAction) && e.h < 60 && e.w < 400
            );
            if (menuItems.length) break;
            await new Promise(r => setTimeout(r, 500));
          }

          if (!menuItems.length) {
            // Last attempt: get ALL elements and report what's available
            const result2 = await collectAndAnalyze(tabId);
            const available = result2.elements
              .filter(e => e.h < 60 && e.w < 400 && e.name.length > 1 && e.name.length < 50)
              .map(e => e.name)
              .filter((v, i, a) => a.indexOf(v) === i)
              .slice(0, 20);
            sendResult(cmd, false, null, `Menu item "${cmd.menuAction}" not found. Available: ${available.join(', ')}`);
            break;
          }

          menuItems.sort((a, b) => a.name.length - b.name.length);
          const item = menuItems[0];

          // Step 5: Scroll to menu item + get viewport coords + CDP click
          if (item.backend_node_id) {
            try { await cdpSend(tabId, 'DOM.scrollIntoViewIfNeeded', { backendNodeId: item.backend_node_id }); } catch {}
            await new Promise(r => setTimeout(r, 100));
          }
          let itemX = item.x + item.w / 2, itemY = item.y + item.h / 2;
          if (item.backend_node_id) {
            try {
              const q2 = await cdpSend(tabId, 'DOM.getContentQuads', { backendNodeId: item.backend_node_id });
              if (q2.quads?.[0]?.length >= 8) {
                const q = q2.quads[0];
                itemX = (q[0] + q[2] + q[4] + q[6]) / 4;
                itemY = (q[1] + q[3] + q[5] + q[7]) / 4;
              }
            } catch {}
          }
          await cdpClick(tabId, itemX, itemY);
          await new Promise(r => setTimeout(r, 1200));

          // Step 6: Check for confirmation dialog
          const result3 = await collectAndAnalyze(tabId);
          const confirmWords = [menuAction, 'yes', 'confirm', 'ok', 'delete'];
          const confirmBtns = result3.elements.filter(e =>
            e.tag === 'button' && confirmWords.some(w => e.name.toLowerCase().includes(w)) && e.h < 60
          );
          let confirmed = false;
          if (confirmBtns.length) {
            const cb = confirmBtns[confirmBtns.length - 1];
            let cbX = cb.x + cb.w / 2, cbY = cb.y + cb.h / 2;
            if (cb.backend_node_id) {
              try {
                const q3 = await cdpSend(tabId, 'DOM.getContentQuads', { backendNodeId: cb.backend_node_id });
                if (q3.quads?.[0]?.length >= 8) { const q = q3.quads[0]; cbX = (q[0]+q[2]+q[4]+q[6])/4; cbY = (q[1]+q[3]+q[5]+q[7])/4; }
              } catch {}
            }
            await cdpClick(tabId, cbX, cbY);
            confirmed = true;
          }

          sendResult(cmd, true, { ok: true, menuClicked: overflow.button.aria_label || 'menu', actionClicked: item.name, confirmed });
          break;
        } catch (err) { sendResult(cmd, false, null, err.message); break; }
      }

      // ── Key press ──
      case 'keyPress': {
        try {
          await cdpAttach(tabId);
          const KEY_MAP = { Enter:{key:'Enter',code:'Enter',vk:13}, Tab:{key:'Tab',code:'Tab',vk:9}, Escape:{key:'Escape',code:'Escape',vk:27}, Backspace:{key:'Backspace',code:'Backspace',vk:8}, Space:{key:' ',code:'Space',vk:32}, ArrowDown:{key:'ArrowDown',code:'ArrowDown',vk:40}, ArrowUp:{key:'ArrowUp',code:'ArrowUp',vk:38} };
          const k = KEY_MAP[cmd.key] || { key: cmd.key, code: cmd.key, vk: 0 };
          await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk });
          await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code });
          sendResult(cmd, true, { ok: true }); break;
        } catch (err) { sendResult(cmd, false, null, err.message); break; }
      }

      // ── Scroll ──
      case 'scroll': {
        await ensureContentScript(tabId);
        chrome.tabs.sendMessage(tabId, { action: 'scroll', x: cmd.x || 0, y: cmd.y || 0 }, res => sendResult(cmd, true, res || {}));
        break;
      }

      // ── Screenshot ──
      case 'screenshot': {
        try {
          const tab = tabId ? await chrome.tabs.get(tabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
          const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: SCREENSHOT_QUALITY });
          sendResult(cmd, true, { dataUrl, url: tab.url, title: tab.title }); break;
        } catch (err) { sendResult(cmd, false, null, err.message); break; }
      }

      // ── Tab management ──
      case 'newTab': {
        let url = cmd.url;
        if (url && !url.startsWith('http') && !url.startsWith('file:')) url = 'https://' + url;

        if (url) {
          try {
            const targetUrl = new URL(url);
            const all = await chrome.tabs.query({});

            // First: check for EXACT URL match — just switch, no reload
            const exact = all.find(t => {
              if (!t.url || isProtectedTab(t)) return false;
              try { const u = new URL(t.url); return u.hostname === targetUrl.hostname && u.pathname === targetUrl.pathname; } catch { return false; }
            });
            if (exact) {
              await chrome.tabs.update(exact.id, { active: true });
              lastAgentTabId = exact.id; streamingTabId = exact.id;
              const t = await chrome.tabs.get(exact.id);
              sendResult(cmd, true, { tabId: exact.id, url: t.url, title: t.title, reused: true, skippedReload: true });
              break;
            }

            // Second: check for same hostname — navigate existing tab (don't create new)
            const sameHost = all.find(t => {
              if (!t.url || isProtectedTab(t)) return false;
              try { return new URL(t.url).hostname === targetUrl.hostname; } catch { return false; }
            });
            if (sameHost) {
              await chrome.tabs.update(sameHost.id, { url, active: true });
              await waitForPageLoad(sameHost.id);
              lastAgentTabId = sameHost.id; streamingTabId = sameHost.id;
              const t = await chrome.tabs.get(sameHost.id);
              sendResult(cmd, true, { tabId: sameHost.id, url: t.url, title: t.title, reused: true });
              break;
            }
          } catch {}
        }

        // No existing tab — create new
        const nt = await chrome.tabs.create({ url: url || 'about:blank', active: true });
        if (url) await waitForPageLoad(nt.id);
        await ensureContentScript(nt.id);
        lastAgentTabId = nt.id; streamingTabId = nt.id;
        const t = await chrome.tabs.get(nt.id);
        sendResult(cmd, true, { tabId: nt.id, url: t.url, title: t.title });
        break;
      }

      case 'getTabList': { const tabs = await chrome.tabs.query({}); sendResult(cmd, true, { tabs: tabs.filter(t => !isProtectedTab(t)).map(t => ({ tabId: t.id, url: t.url, title: t.title, active: t.active })) }); break; }
      case 'switchTab': { try { await chrome.tabs.update(cmd.targetTabId || cmd.tabId, { active: true }); streamingTabId = cmd.targetTabId || cmd.tabId; sendResult(cmd, true, {}); } catch (e) { sendResult(cmd, false, null, e.message); } break; }
      case 'closeTab': { try { await chrome.tabs.remove(cmd.targetTabId || tabId); sendResult(cmd, true, {}); } catch (e) { sendResult(cmd, false, null, e.message); } break; }
      case 'checkConnection': { sendResult(cmd, true, { status, connected: status === 'connected' }); break; }

      default: sendResult(cmd, false, null, `Unknown action: ${cmd.action}`);
    }
  } catch (err) { sendResult(cmd, false, null, err.message || 'Unknown error'); }
}

/* ── Popup ── */
chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg.type === 'getStatus') { sendResponse({ status, error: lastError, tabCount: sessions.size }); return false; }
  if (msg.type === 'connect') { connect(); sendResponse({ status, error: lastError }); return false; }
  if (msg.type === 'disconnect') { disconnect(); sendResponse({ status: 'disconnected', error: '' }); return false; }
  return false;
});

connect();
