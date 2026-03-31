/**
 * background.js — Browser Agent v5 (Human-Like CDP)
 *
 * ARCHITECTURE:
 * - Element discovery: CDP Accessibility.getFullAXTree + enhanced DOM scan
 *   Natively traverses all shadow roots. Fallback DOM scan catches contenteditable
 *   and lazy-rendered elements that the AX tree misses (e.g., LinkedIn message boxes).
 *
 * - All interactions: CDP Input.dispatchMouseEvent / Input.dispatchKeyEvent / Input.insertText
 *   Produces isTrusted:true events. Human-like bezier mouse paths with hover warmup.
 *
 * - Mouse tracking: Maintains last known mouse position per tab for realistic movement paths.
 *   Mouse moves along bezier curves (not teleporting), with micro-jitter and variable speed.
 *
 * - content.js: Lightweight — scroll, waitForDOM, waitForElement, getPageText, enhanced DOM scan
 *
 * KEY INNOVATIONS OVER V2:
 * 1. Bezier curve mouse paths (15-35 intermediate mouseMoved events)
 * 2. Hover dwell before clicks (50-200ms)
 * 3. Click coordinate jitter (±3px from center)
 * 4. Enhanced element discovery for LinkedIn/complex apps
 * 5. Mouse position tracking across actions
 * 6. Human-like typing with variable delays
 */

/* ══════════════════════════════════════════════════════════
 *  CONSTANTS
 * ══════════════════════════════════════════════════════════ */
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
const CLICK_DELAYS       = [0, 300, 800];
const MAX_ELEMENTS       = 120;

/* ══════════════════════════════════════════════════════════
 *  STATE
 * ══════════════════════════════════════════════════════════ */
let ws = null;
let status = 'disconnected';
let lastError = '';
let userDisconnected = false;
let streamingTabId = null;
const sessions = new Map(); // tabId → { queue, running, elementIndex, mouseX, mouseY }

/* ── CDP state ── */
const cdpAttached  = new Set();
const cdpAttaching = new Map();
const cdpAxEnabled = new Set();

/* ── Agent tab tracking ── */
let lastAgentTabId = null;

/* ══════════════════════════════════════════════════════════
 *  HUMAN MOUSE ENGINE (inlined — service workers can't import)
 * ══════════════════════════════════════════════════════════ */

function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

function bezierPoint(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/**
 * Generate bezier mouse path from (x0,y0) to (x1,y1).
 * Returns [{x, y, delay}] — delay = ms to wait before dispatching this mouseMoved.
 */
function generateMousePath(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < 10) {
    return [
      { x: x0, y: y0, delay: 0 },
      { x: x1, y: y1, delay: randInt(8, 20) },
    ];
  }

  const steps = Math.max(8, Math.min(35, Math.round(distance / rand(12, 20))));

  const perpX = -dy / distance;
  const perpY = dx / distance;
  const curvature = rand(0.1, 0.35) * distance;
  const curveDir = Math.random() > 0.5 ? 1 : -1;

  const cp1x = x0 + dx * 0.3 + perpX * curvature * curveDir * rand(0.3, 0.7);
  const cp1y = y0 + dy * 0.3 + perpY * curvature * curveDir * rand(0.3, 0.7);
  const cp2x = x0 + dx * 0.7 + perpX * curvature * curveDir * rand(0.0, 0.3);
  const cp2y = y0 + dy * 0.7 + perpY * curvature * curveDir * rand(0.0, 0.3);

  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const eased = t * t * (3 - 2 * t);

    let x = bezierPoint(eased, x0, cp1x, cp2x, x1);
    let y = bezierPoint(eased, y0, cp1y, cp2y, y1);

    if (i > 0 && i < steps) {
      x += rand(-1.5, 1.5);
      y += rand(-1.5, 1.5);
    }

    let delay = i === 0 ? 0 : Math.round(randInt(6, 14) * (1 - 0.5 * Math.sin(Math.PI * t)));
    points.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, delay });
  }

  // Occasional overshoot + correction (40% of longer moves)
  if (distance > 100 && Math.random() > 0.6) {
    const ov = rand(0.02, 0.06);
    points.push({ x: Math.round((x1 + dx * ov + rand(-2, 2)) * 10) / 10, y: Math.round((y1 + dy * ov + rand(-2, 2)) * 10) / 10, delay: randInt(8, 15) });
    points.push({ x: Math.round((x1 + rand(-1, 1)) * 10) / 10, y: Math.round((y1 + rand(-1, 1)) * 10) / 10, delay: randInt(20, 40) });
  }

  return points;
}

function jitterClick(x, y, radius = 3) {
  const angle = Math.random() * Math.PI * 2;
  const r = Math.random() * radius * Math.random();
  return {
    x: Math.round((x + Math.cos(angle) * r) * 10) / 10,
    y: Math.round((y + Math.sin(angle) * r) * 10) / 10,
  };
}

/** Move mouse along bezier curve, dispatching mouseMoved events. */
async function humanMouseMove(tabId, fromX, fromY, toX, toY) {
  const path = generateMousePath(fromX, fromY, toX, toY);
  for (const pt of path) {
    if (pt.delay > 0) await new Promise(r => setTimeout(r, pt.delay));
    await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, button: 'none' });
  }
}

/**
 * Full human-like click: bezier move → hover dwell → jittered press/release.
 * Updates session mouse position.
 */
async function humanClick(tabId, toX, toY) {
  const session = sessions.get(tabId) || { mouseX: 0, mouseY: 0 };
  const fromX = session.mouseX || rand(100, 400);
  const fromY = session.mouseY || rand(100, 300);

  // 1. Bezier mouse movement
  await humanMouseMove(tabId, fromX, fromY, toX, toY);

  // 2. Hover dwell (50-180ms)
  await new Promise(r => setTimeout(r, randInt(50, 180)));

  // 3. Jittered click
  const { x: cx, y: cy } = jitterClick(toX, toY);

  await cdpSend(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1, modifiers: 0,
  });

  // Hold duration (50-120ms)
  await new Promise(r => setTimeout(r, randInt(50, 120)));

  await cdpSend(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1, modifiers: 0,
  });

  // Update mouse position
  if (sessions.has(tabId)) {
    const s = sessions.get(tabId);
    s.mouseX = cx;
    s.mouseY = cy;
  }

  return { clickX: cx, clickY: cy };
}

/** Human-like hover without click. */
async function humanHoverAction(tabId, toX, toY) {
  const session = sessions.get(tabId) || { mouseX: 0, mouseY: 0 };
  const fromX = session.mouseX || rand(100, 400);
  const fromY = session.mouseY || rand(100, 300);

  await humanMouseMove(tabId, fromX, fromY, toX, toY);
  await new Promise(r => setTimeout(r, randInt(100, 300)));

  if (sessions.has(tabId)) {
    const s = sessions.get(tabId);
    s.mouseX = toX;
    s.mouseY = toY;
  }
}

/* ══════════════════════════════════════════════════════════
 *  CDP SESSION MANAGER
 * ══════════════════════════════════════════════════════════ */

async function cdpAttach(tabId) {
  if (cdpAttached.has(tabId)) return true;
  if (cdpAttaching.has(tabId)) return cdpAttaching.get(tabId);

  const p = new Promise((resolve) => {
    chrome.debugger.attach({ tabId }, CDP_VERSION, () => {
      cdpAttaching.delete(tabId);
      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message || '';
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

function cdpDetach(tabId) {
  cdpAxEnabled.delete(tabId);
  if (!cdpAttached.has(tabId)) return;
  chrome.debugger.detach({ tabId }, () => { chrome.runtime.lastError; });
  cdpAttached.delete(tabId);
}

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

async function ensureAx(tabId) {
  if (cdpAxEnabled.has(tabId)) return;
  await cdpSend(tabId, 'Accessibility.enable', {});
  cdpAxEnabled.add(tabId);
}

chrome.debugger.onDetach.addListener((source, reason) => {
  const tabId = source.tabId;
  cdpAttached.delete(tabId);
  cdpAxEnabled.delete(tabId);
  if (reason === 'canceled_by_user') {
    chrome.storage.session.set({ [`cdpConflict_${tabId}`]: true }).catch(() => {});
  }
});

/* ══════════════════════════════════════════════════════════
 *  ELEMENT DISCOVERY — Enhanced CDP AX Tree + DOM Fallback
 * ══════════════════════════════════════════════════════════ */

const INTERACTIVE_AX_ROLES = new Set([
  'button', 'link', 'textBox', 'comboBox', 'searchBox',
  'checkBox', 'radioButton', 'menuItem', 'menuItemCheckBox', 'menuItemRadio',
  'option', 'tab', 'treeItem', 'slider', 'spinButton', 'switch', 'gridCell',
  'columnHeader', 'rowHeader', 'menuBar', 'listBox',
]);

/**
 * Build element snapshot from CDP Accessibility tree.
 * Enhanced: also runs a DOM scan for contenteditable/tabindex elements that
 * the AX tree misses (common on LinkedIn, Slack, Google Docs).
 */
async function getElementsViaCDP(tabId) {
  const attached = await cdpAttach(tabId);
  if (!attached) throw new Error('Cannot attach CDP to this tab');

  await ensureAx(tabId);
  const { nodes } = await cdpSend(tabId, 'Accessibility.getFullAXTree', {});

  const elementIndex = new Map();
  const lines = [];
  let id = 1;
  const seenBackendIds = new Set();

  for (const node of nodes) {
    if (!node.role || !INTERACTIVE_AX_ROLES.has(node.role.value)) continue;
    if (!node.backendDOMNodeId) continue;
    if (node.ignored) continue;

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

    // Property annotations
    const props = node.properties || [];
    const focused = props.find(p => p.name === 'focused');
    if (focused?.value?.value === true) line += ' [FOCUSED]';
    const checked = props.find(p => p.name === 'checked');
    if (checked?.value?.value === 'true' || checked?.value?.value === true) line += ' [CHECKED]';
    const expanded = props.find(p => p.name === 'expanded');
    if (expanded?.value?.value === true) line += ' [EXPANDED]';
    const disabled = props.find(p => p.name === 'disabled');
    if (disabled?.value?.value === true) line += ' [DISABLED]';
    const hasPopup = props.find(p => p.name === 'hasPopup');
    if (hasPopup?.value?.value && hasPopup.value.value !== 'false') line += ' [MENU]';
    const pressed = props.find(p => p.name === 'pressed');
    if (pressed?.value?.value !== undefined) line += ` pressed=${pressed.value.value}`;
    const required = props.find(p => p.name === 'required');
    if (required?.value?.value === true) line += ' [REQUIRED]';
    const readOnly = props.find(p => p.name === 'readonly');
    if (readOnly?.value?.value === true) line += ' [READONLY]';

    seenBackendIds.add(node.backendDOMNodeId);
    elementIndex.set(id, { backendDOMNodeId: node.backendDOMNodeId, role, name });
    lines.push(line);

    if (id >= MAX_ELEMENTS) break;
    id++;
  }

  // ── Enhanced DOM scan for elements the AX tree missed ──
  // LinkedIn message boxes, contenteditable divs, tabindex clickables, etc.
  // These are often missing from the AX tree because they lack proper ARIA roles.
  try {
    const enhancedElements = await getEnhancedDOMElements(tabId, seenBackendIds);
    for (const elem of enhancedElements) {
      if (id > MAX_ELEMENTS) break;
      elementIndex.set(id, { backendDOMNodeId: elem.backendDOMNodeId, role: elem.role, name: elem.name });
      lines.push(`  [${id}] ${elem.role} "${elem.name}"${elem.extra || ''}`);
      id++;
    }
  } catch { /* non-critical — AX tree alone is usually sufficient */ }

  return { lines, elementIndex };
}

/**
 * Enhanced DOM scan via Runtime.evaluate — catches elements the AX tree misses.
 * Specifically targets: contenteditable, tabindex clickables, rich text editors.
 */
async function getEnhancedDOMElements(tabId, seenBackendIds) {
  const { result } = await cdpSend(tabId, 'Runtime.evaluate', {
    expression: `(() => {
      const found = [];
      const seen = new WeakSet();

      const SELECTORS = [
        '[contenteditable="true"]',
        '[contenteditable=""]',
        '[tabindex]:not([tabindex="-1"]):not(button):not(a):not(input):not(textarea):not(select)',
        '[role="textbox"]:not(input):not(textarea)',
        '[role="dialog"] [contenteditable]',
        '[role="dialog"] textarea',
        '[role="dialog"] input:not([type="hidden"])',
        '.msg-form__contenteditable',
        '.ql-editor',
        '[data-placeholder]',
        '.ProseMirror',
        '.DraftEditor-root',
        '[data-testid*="message"]',
        '[data-testid*="compose"]',
        '[aria-label*="message" i]',
        '[aria-label*="write" i]',
        '[aria-label*="compose" i]',
        '[aria-label*="reply" i]',
        '[aria-label*="comment" i]',
        '[aria-label*="conversation" i]',
        '[placeholder*="comment" i]',
        '[placeholder*="conversation" i]',
        '[placeholder*="reply" i]',
        '[placeholder*="write" i]',
      ];

      function addElement(el, depth) {
        if (seen.has(el)) return;
        seen.add(el);
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        try {
          const s = getComputedStyle(el);
          if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return;
        } catch { return; }

        const label = el.getAttribute('aria-label') || el.getAttribute('placeholder') ||
                      el.getAttribute('data-placeholder') || el.getAttribute('title') ||
                      (el.innerText || '').trim().slice(0, 60) || el.className?.split?.(' ')?.[0] || '';
        if (!label) return;

        let role = 'textbox';
        if (el.isContentEditable || el.getAttribute('contenteditable') !== null) role = 'editor';
        else if (el.tagName === 'INPUT') role = el.type || 'input';
        else if (el.tagName === 'TEXTAREA') role = 'textarea';
        else if (el.tabIndex >= 0) role = 'clickable';

        found.push({
          label: label.replace(/\\s+/g, ' ').slice(0, 80),
          role,
          tag: el.tagName.toLowerCase(),
          rect: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        });
      }

      function scan(root, depth) {
        if (depth > 10) return;  // deeper traversal for Reddit's nested shadow DOM
        try {
          // Standard selector scan
          const els = root.querySelectorAll(SELECTORS.join(','));
          for (const el of els) addElement(el, depth);

          // Walk ALL shadow roots — this is critical for Reddit (shreddit-*) and other web components
          for (const el of root.querySelectorAll('*')) {
            if (el.shadowRoot) scan(el.shadowRoot, depth + 1);
          }
        } catch {}
      }
      scan(document, 0);

      // Second pass: search for elements by visible text patterns
      // Reddit's "Join the conversation" placeholder is just text inside a div, not an aria attribute
      if (found.length === 0 || !found.some(f => f.role === 'editor' || f.role === 'textbox' || f.role === 'textarea')) {
        function textScan(root, depth) {
          if (depth > 10) return;
          try {
            for (const el of root.querySelectorAll('div, p, span')) {
              const text = (el.textContent || '').trim().toLowerCase();
              if (text.includes('join the conversation') || text.includes('add a comment') ||
                  text.includes('write a comment') || text.includes('what are your thoughts') ||
                  text.includes('write a message') || text.includes('type a message')) {
                const rect = el.getBoundingClientRect();
                if (rect.width > 50 && rect.height > 10) {
                  // This might be a clickable placeholder — find the closest interactive parent
                  let target = el;
                  for (let p = el; p; p = p.parentElement) {
                    if (p.tabIndex >= 0 || p.getAttribute('role') === 'textbox' || p.isContentEditable ||
                        p.tagName === 'BUTTON' || p.getAttribute('contenteditable') !== null) {
                      target = p;
                      break;
                    }
                  }
                  found.push({
                    label: (el.textContent || '').trim().slice(0, 80),
                    role: 'comment-placeholder',
                    tag: target.tagName.toLowerCase(),
                    rect: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
                  });
                }
              }
            }
            for (const el of root.querySelectorAll('*')) {
              if (el.shadowRoot) textScan(el.shadowRoot, depth + 1);
            }
          } catch {}
        }
        textScan(document, 0);
      }

      return found.slice(0, 30);
    })()`,
    returnByValue: true,
  });

  if (!result?.value || !Array.isArray(result.value)) return [];

  // Resolve each to a backendDOMNodeId for CDP interaction
  const elements = [];
  for (const item of result.value) {
    try {
      // Find the element again and get its backendDOMNodeId via DOM.getDocument + DOM.querySelector
      // We use a coordinate-based approach: DOM.getNodeForLocation
      const nodeResult = await cdpSend(tabId, 'DOM.getNodeForLocation', {
        x: Math.round(item.rect.x),
        y: Math.round(item.rect.y),
        includeUserAgentShadowDOM: true,
      });
      if (nodeResult.backendNodeId && !seenBackendIds.has(nodeResult.backendNodeId)) {
        seenBackendIds.add(nodeResult.backendNodeId);
        elements.push({
          backendDOMNodeId: nodeResult.backendNodeId,
          role: item.role,
          name: item.label,
          extra: item.role === 'editor' ? ' [CONTENTEDITABLE]' : '',
        });
      }
    } catch { /* element may have been removed */ }
  }

  return elements;
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
  const m = s.match(/^\[(\d+)\]$/) ||
            s.match(/data-psh-id="(\d+)"/) ||
            (s.match(/^\d+$/) ? [null, s] : null);
  if (!m) return null;

  const id = parseInt(m[1], 10);
  return session.elementIndex.get(id) || null;
}

/* ══════════════════════════════════════════════════════════
 *  CDP INTERACTION HELPERS
 * ══════════════════════════════════════════════════════════ */

/**
 * Get element center coordinates using browser-use's 3-method fallback chain:
 * 1. DOM.getContentQuads (best for inline/complex layouts)
 * 2. DOM.getBoxModel (fallback)
 * 3. JS getBoundingClientRect (last resort)
 */
async function getNodeCenter(tabId, backendDOMNodeId) {
  // Scroll into view first
  try {
    await cdpSend(tabId, 'DOM.scrollIntoViewIfNeeded', { backendNodeId: backendDOMNodeId });
    await new Promise(r => setTimeout(r, 50));
  } catch { /* already visible */ }

  // Method 1: DOM.getContentQuads — most accurate for inline elements
  try {
    const quadsResult = await cdpSend(tabId, 'DOM.getContentQuads', { backendNodeId: backendDOMNodeId });
    if (quadsResult.quads && quadsResult.quads.length > 0) {
      const quad = quadsResult.quads[0];
      if (quad.length >= 8) {
        const xs = [quad[0], quad[2], quad[4], quad[6]];
        const ys = [quad[1], quad[3], quad[5], quad[7]];
        const w = Math.max(...xs) - Math.min(...xs);
        const h = Math.max(...ys) - Math.min(...ys);
        if (w > 0 && h > 0) {
          return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
        }
      }
    }
  } catch {}

  // Method 2: DOM.getBoxModel
  try {
    const boxResult = await cdpSend(tabId, 'DOM.getBoxModel', { backendNodeId: backendDOMNodeId });
    if (boxResult.model?.content?.length >= 8) {
      const c = boxResult.model.content;
      const xs = [c[0], c[2], c[4], c[6]];
      const ys = [c[1], c[3], c[5], c[7]];
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      if (w > 0 && h > 0) {
        return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
      }
    }
  } catch {}

  // Method 3: JS getBoundingClientRect (last resort)
  const { object } = await cdpSend(tabId, 'DOM.resolveNode', { backendNodeId: backendDOMNodeId });
  const { result } = await cdpSend(tabId, 'Runtime.callFunctionOn', {
    objectId: object.objectId,
    functionDeclaration: `function() {
      const r = this.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    }`,
    returnByValue: true,
  });
  await cdpSend(tabId, 'Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});

  if (!result?.value || !result.value.w || !result.value.h) {
    throw new Error('Element has zero size — likely hidden or not rendered');
  }
  return { x: result.value.x, y: result.value.y };
}

/**
 * Focus an element using browser-use's fallback chain:
 * 1. CDP DOM.focus() (most reliable)
 * 2. Click to focus
 */
async function focusElement(tabId, backendDOMNodeId) {
  // Method 1: CDP DOM.focus
  try {
    await cdpSend(tabId, 'DOM.focus', { backendNodeId: backendDOMNodeId });
    return true;
  } catch {}
  // Method 2: Click to focus
  try {
    const { x, y } = await getNodeCenter(tabId, backendDOMNodeId);
    await humanClick(tabId, x, y);
    return true;
  } catch {}
  return false;
}

/**
 * Type text character by character using browser-use's CORRECT 3-event pattern:
 * - keyDown: key=baseKey, code=keyCode, NO text field
 * - char: text=actualChar (THIS is where insertion happens)
 * - keyUp: key=baseKey, code=keyCode
 *
 * The key insight: keyDown must NOT include text field, otherwise double insertion.
 */
async function cdpTypeText(tabId, text, delay = 1) {
  // Shift character mapping (browser-use pattern)
  const SHIFT_CHARS = {
    '!':'1','@':'2','#':'3','$':'4','%':'5','^':'6','&':'7','*':'8','(':'9',')':'0',
    '_':'-','+':'=','{':'[','}':']','|':'\\',':':';','"':"'",'<':',','>':'.','?':'/','~':'`',
  };
  const KEY_CODES = {
    ' ':'Space','.':'Period',',':'Comma','-':'Minus','=':'Equal',
    '[':'BracketLeft',']':'BracketRight','\\':'Backslash',';':'Semicolon',
    "'":"Quote",'/':'Slash','`':'Backquote',
  };

  for (const char of text) {
    if (char === '\n') {
      await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await new Promise(r => setTimeout(r, 1));
      await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'char', text: '\r', key: 'Enter' });
      await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    } else {
      let modifiers = 0;
      let baseKey = char;
      let code = '';

      if (SHIFT_CHARS[char]) {
        modifiers = 8; // Shift
        baseKey = SHIFT_CHARS[char];
      } else if (char >= 'A' && char <= 'Z') {
        modifiers = 8; // Shift
        baseKey = char.toLowerCase();
      }

      // Determine code
      if (baseKey >= 'a' && baseKey <= 'z') code = 'Key' + baseKey.toUpperCase();
      else if (baseKey >= '0' && baseKey <= '9') code = 'Digit' + baseKey;
      else code = KEY_CODES[baseKey] || '';

      // keyDown — NO text field (browser-use pattern)
      await cdpSend(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyDown', key: baseKey, code, modifiers,
        windowsVirtualKeyCode: baseKey.charCodeAt(0),
      });
      await new Promise(r => setTimeout(r, 5)); // 5ms like browser-use

      // char — WITH text (this is where character insertion happens)
      await cdpSend(tabId, 'Input.dispatchKeyEvent', {
        type: 'char', text: char, key: char,
      });

      // keyUp — NO text field
      await cdpSend(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyUp', key: baseKey, code, modifiers,
        windowsVirtualKeyCode: baseKey.charCodeAt(0),
      });
    }

    if (delay > 0) await new Promise(r => setTimeout(r, delay));
  }
}

/* ══════════════════════════════════════════════════════════
 *  COMMAND HANDLERS — Human-Like CDP
 * ══════════════════════════════════════════════════════════ */

/** Click with human mouse + retry. Auto-rescans on node-not-found. */
async function handleClick(tabId, selector) {
  let entry = resolveBackendNode(tabId, selector);

  if (!entry) {
    await refreshElementIndex(tabId);
    entry = resolveBackendNode(tabId, selector);
    if (!entry) throw new Error(`Element not found: ${selector}`);
  }

  for (let attempt = 0; attempt < CLICK_RETRIES; attempt++) {
    if (CLICK_DELAYS[attempt] > 0) await new Promise(r => setTimeout(r, CLICK_DELAYS[attempt]));

    try {
      const { x, y } = await getNodeCenter(tabId, entry.backendDOMNodeId);
      const { clickX, clickY } = await humanClick(tabId, x, y);
      return { ok: true, x: clickX, y: clickY, method: 'human-cdp', attempt };
    } catch (err) {
      if (err.code === 'CDP_NODE_NOT_FOUND') {
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

/** Type text into an element — browser-use inspired approach. */
async function handleType(tabId, selector, text) {
  const attached = await cdpAttach(tabId);
  if (!attached) throw new Error('Cannot attach CDP');

  // Step 1: Focus the element using CDP DOM.focus + click fallback
  const entry = resolveBackendNode(tabId, selector);
  if (entry) {
    await focusElement(tabId, entry.backendDOMNodeId);
    await new Promise(r => setTimeout(r, 300));
  }

  // Step 2: Clear existing content (Ctrl+A → Backspace, like browser-use)
  await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  await new Promise(r => setTimeout(r, 30));
  await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await new Promise(r => setTimeout(r, 50));

  // Step 3: Try Input.insertText first (atomic, reliable for most inputs)
  await cdpSend(tabId, 'Input.insertText', { text });
  await new Promise(r => setTimeout(r, 200));

  // Step 4: Verify
  const verifyResult = await cdpSend(tabId, 'Runtime.evaluate', {
    expression: `(() => {
      let el = document.activeElement;
      while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
      if (!el) return { ok: false };
      const c = el.isContentEditable ? (el.innerText || '').trim() : (el.value || '').trim();
      return { ok: c.length > 0, content: c.slice(0, 100) };
    })()`,
    returnByValue: true,
  });

  // Step 5: If insertText failed, fallback to char-by-char (browser-use pattern)
  if (!verifyResult?.result?.value?.ok) {
    await cdpTypeText(tabId, text, randInt(1, 5));
  }

  return { ok: true, verified: verifyResult?.result?.value?.ok || false };
}

/** Type character by character with human-like delays — browser-use pattern. */
async function handleTypeChar(tabId, selector, text, baseDelay = 80) {
  const attached = await cdpAttach(tabId);
  if (!attached) throw new Error('Cannot attach CDP');

  // Focus element
  const entry = resolveBackendNode(tabId, selector);
  if (entry) {
    await focusElement(tabId, entry.backendDOMNodeId);
    await new Promise(r => setTimeout(r, 300));
  }

  // Type using corrected browser-use pattern with variable delays
  for (const char of text) {
    let delay = baseDelay * rand(0.6, 1.4);
    if (Math.random() < 0.08) delay += randInt(100, 300);

    // Use cdpTypeText for single char to get correct keyDown/char/keyUp pattern
    await cdpTypeText(tabId, char, 0);
    if (delay > 0) await new Promise(r => setTimeout(r, Math.round(delay)));
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

async function handleKeypress(tabId, key) {
  const attached = await cdpAttach(tabId);
  if (!attached) throw new Error('Cannot attach CDP');

  const k = KEY_MAP[key] || { key, code: key, windowsVirtualKeyCode: 0 };
  await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: k.key, code: k.code, windowsVirtualKeyCode: k.windowsVirtualKeyCode });
  if (key === 'Space') {
    await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyPress', key: k.key, code: k.code, windowsVirtualKeyCode: k.windowsVirtualKeyCode });
  }
  await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.windowsVirtualKeyCode });
  return { ok: true };
}

/** Hover over element with human-like mouse path. */
async function handleHover(tabId, selector) {
  const entry = resolveBackendNode(tabId, selector);
  if (!entry) throw new Error(`Element not found for hover: ${selector}`);

  const { x, y } = await getNodeCenter(tabId, entry.backendDOMNodeId);
  await humanHoverAction(tabId, x, y);
  return { ok: true, x, y };
}

/** Build LLM snapshot from CDP AX tree + DOM scan + page text. */
async function handleGetElements(tabId) {
  const tab = await chrome.tabs.get(tabId);

  let pageText = '';
  try {
    const info = await sendToContent(tabId, { action: 'getPageText' });
    pageText = info?.text || '';
  } catch { /* non-critical */ }

  // Get modal/dialog info from content script
  let modalInfo = '';
  try {
    const modal = await sendToContent(tabId, { action: 'detectModal' });
    if (modal?.active) {
      modalInfo = `\n!! MODAL/POPUP ACTIVE: "${modal.title}" (${modal.role})\n   → Handle this popup before continuing. Look for Close/Done/Cancel/X buttons.\n`;
    }
  } catch {}

  const { lines, elementIndex } = await getElementsViaCDP(tabId);

  const session = sessions.get(tabId);
  if (session) session.elementIndex = elementIndex;

  const snapshot = [
    `PAGE: ${tab.url}`,
    `TITLE: ${tab.title}`,
    pageText ? `TEXT: ${pageText}` : '',
    modalInfo,
    `ELEMENTS (use [N] as selector):`,
    ...lines,
  ].filter(l => l !== undefined).join('\n');

  return { snapshot };
}

/* ══════════════════════════════════════════════════════════
 *  DOM FALLBACK (chrome:// pages, DevTools open)
 * ══════════════════════════════════════════════════════════ */

async function handleClickFallback(tabId, selector) {
  const entry = resolveBackendNode(tabId, selector);
  const labelText = entry?.name || '';

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN',
    func: (label) => {
      function findByLabel(root, depth) {
        if (depth > 8) return null;
        const candidates = root.querySelectorAll(
          'button, a[href], input, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [aria-label], [contenteditable]'
        );
        for (const el of candidates) {
          const text = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
          if (label && text.toLowerCase().includes(label.toLowerCase())) return el;
        }
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) { const found = findByLabel(el.shadowRoot, depth + 1); if (found) return found; }
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

/* ══════════════════════════════════════════════════════════
 *  POPUP BLOCKER BYPASS
 * ══════════════════════════════════════════════════════════ */
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
          if (!w) { window.location.href = url; }
          return w;
        }
        return origOpen.call(window, url, target, features);
      };
    }
  }).catch(() => {});
});

/* ══════════════════════════════════════════════════════════
 *  KEEPALIVE
 * ══════════════════════════════════════════════════════════ */
chrome.alarms.create('keepalive', { periodInMinutes: KEEPALIVE_MINUTES });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive' && !userDisconnected && status === 'disconnected') connect();
});
setInterval(() => { if (!userDisconnected && status === 'disconnected') connect(); }, 20000);

/* ══════════════════════════════════════════════════════════
 *  WEBSOCKET
 * ══════════════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════════════
 *  TAB EVENTS
 * ══════════════════════════════════════════════════════════ */
chrome.tabs.onCreated.addListener((tab) => send({ type: 'tabEvent', event: 'created', tabId: tab.id, url: tab.url || '', title: tab.title || '' }));
chrome.tabs.onRemoved.addListener((tabId) => {
  sessions.delete(tabId);
  cdpDetach(tabId);
  send({ type: 'tabEvent', event: 'closed', tabId });
});
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.title) send({ type: 'tabEvent', event: 'updated', tabId, url: tab.url, title: tab.title });
});

// Invalidate element index on page navigation
chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return;
  const session = sessions.get(details.tabId);
  if (session) {
    session.elementIndex = null;
    session.mouseX = rand(100, 400); // Reset mouse to random position
    session.mouseY = rand(100, 300);
  }
});

/* ══════════════════════════════════════════════════════════
 *  FRAME STREAMING
 * ══════════════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════════════
 *  COMMAND QUEUE
 * ══════════════════════════════════════════════════════════ */
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
  if (!sessions.has(tabId)) sessions.set(tabId, { queue: [], running: false, elementIndex: null, mouseX: rand(100, 400), mouseY: rand(100, 300) });
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

/* ══════════════════════════════════════════════════════════
 *  HELPERS
 * ══════════════════════════════════════════════════════════ */
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

async function canUseCDP(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return false;
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) return false;
    return true;
  } catch { return false; }
}

/* ══════════════════════════════════════════════════════════
 *  COMMAND EXECUTION
 * ══════════════════════════════════════════════════════════ */
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

      /* ── Click (human-like) ── */
      case 'click': {
        const cdpOk = await canUseCDP(tabId);
        if (cdpOk) {
          const attached = await cdpAttach(tabId);
          if (attached) {
            if (!sessions.get(tabId)?.elementIndex) {
              await refreshElementIndex(tabId);
            }
            try {
              const result = await handleClick(tabId, cmd.selector);
              // Post-click: settle DOM to catch dynamically rendered elements
              await settleDOM(tabId);
              sendResult(cmd, result?.ok !== false, result, result?.error);
              break;
            } catch (err) {
              console.error('CDP click failed, trying fallback:', err.message);
            }
          }
        }
        try {
          await ensureContentScript(tabId);
          const result = await handleClickFallback(tabId, cmd.selector);
          sendResult(cmd, result?.ok !== false, result, result?.error);
        } catch (err) {
          sendResult(cmd, false, null, err.message);
        }
        break;
      }

      /* ── Click by visible text (find element containing text → human click) ── */
      case 'clickText': {
        const searchText = (cmd.text || '').trim();
        if (!searchText) { sendResult(cmd, false, null, 'No text provided'); break; }

        let urlBefore = '';
        try { const tb = await chrome.tabs.get(tabId); urlBefore = tb.url || ''; } catch {}

        try {
          // Find element by text in MAIN world — returns coordinates
          const [{ result: found }] = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (text) => {
              // Detect if this is a submit-type action (Send, Comment, Post, Submit, etc.)
              const SUBMIT_WORDS = ['send', 'comment', 'post', 'submit', 'reply', 'publish', 'save', 'done', 'ok', 'confirm'];
              const isSubmitAction = SUBMIT_WORDS.includes(text.toLowerCase().trim());

              const candidates = [];
              function walk(root, depth) {
                if (depth > 8) return;
                try {
                  const all = root.querySelectorAll('*');
                  for (const el of all) {
                    const elText = (el.textContent || '').trim().replace(/\s+/g, ' ');
                    if (!elText.toLowerCase().includes(text.toLowerCase())) continue;
                    const rect = el.getBoundingClientRect();
                    if (rect.width === 0 || rect.height === 0) continue;
                    // Skip full-page containers
                    if (rect.width > window.innerWidth * 0.8 && rect.height > window.innerHeight * 0.5) continue;
                    try { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden') continue; } catch { continue; }

                    const tag = el.tagName;
                    const hasPopup = el.getAttribute('aria-haspopup');
                    // Skip dropdown trigger buttons
                    if (hasPopup === 'true' || hasPopup === 'menu') continue;
                    // Skip buttons with aria-expanded (dropdown triggers)
                    if (tag === 'BUTTON' && el.getAttribute('aria-expanded') !== null) continue;

                    let score = 0;

                    // Links with href are HIGHEST priority for navigation
                    if (tag === 'A' && el.href) {
                      score += 20;
                      if (el.href.includes('/in/')) score += 10;
                      if (el.href.includes('/feed/') || el.href.includes('/posts/')) score += 5;
                    }
                    // Tabindex divs (conversation items, cards)
                    else if (el.tabIndex >= 0 && !['BUTTON', 'A', 'INPUT'].includes(tag)) score += 15;
                    // Plain links without href
                    else if (tag === 'A') score += 12;
                    // Buttons
                    else if (tag === 'BUTTON') score += 6;
                    else if (el.getAttribute('role') === 'button') score += 6;

                    // Prefer smaller/more-specific elements
                    score += Math.max(0, 5 - Math.floor(elText.length / 50));
                    // Exact match bonus
                    if (elText.trim().toLowerCase() === text.toLowerCase()) score += 10;
                    // Starts-with bonus
                    if (elText.trim().toLowerCase().startsWith(text.toLowerCase())) score += 7;

                    // ── SUBMIT BUTTON DETECTION (fixes Send/Comment/Post not working) ──
                    // When searching for submit-type words, STRONGLY prefer the actual submit button
                    // over the action-bar button with the same text.
                    if (isSubmitAction && (tag === 'BUTTON' || el.getAttribute('role') === 'button')) {
                      // Submit buttons typically:
                      // 1. Have type="submit"
                      if (el.type === 'submit') score += 25;
                      // 2. Are inside a form or editor container
                      if (el.closest('form, [role="form"], .msg-form, .comments-comment-box, .editor-container, .ql-container')) score += 20;
                      // 3. Have submit-related class names
                      const cls = (el.className || '').toLowerCase();
                      if (cls.includes('submit') || cls.includes('send') || cls.includes('post') || cls.includes('comment-button') || cls.includes('primary')) score += 15;
                      // 4. Have colored/filled background (primary button styling)
                      try {
                        const bg = getComputedStyle(el).backgroundColor;
                        // Non-transparent, non-white background = likely a primary/submit button
                        if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'rgb(255, 255, 255)') score += 12;
                      } catch {}
                      // 5. Are near a contenteditable/textarea (within same container)
                      const parent = el.parentElement;
                      if (parent) {
                        const nearEditor = parent.querySelector('[contenteditable], textarea, .ql-editor, .ProseMirror, .msg-form__contenteditable');
                        if (nearEditor) score += 15;
                        // Also check grandparent
                        const gp = parent.parentElement;
                        if (gp) {
                          const nearEditor2 = gp.querySelector('[contenteditable], textarea, .ql-editor, .ProseMirror');
                          if (nearEditor2) score += 10;
                        }
                      }
                      // 6. Are LOWER on the page (submit buttons are below input areas)
                      // Action-bar "Comment" is above the input, submit "Comment" is below
                      score += Math.min(15, Math.floor(rect.top / 50));
                    }

                    // Penalize common non-target elements
                    const lbl = elText.toLowerCase();
                    if (lbl.includes('premium') || lbl.includes('upgrade') || lbl.includes('sales navigator')) score -= 20;
                    if (tag === 'BUTTON' && (lbl.includes('connect') || lbl.includes('follow'))) score -= 5;
                    // Penalize action bar buttons when looking for submit (they open the editor, not submit)
                    if (isSubmitAction && tag === 'SPAN' && el.closest('[class*="social-action"]')) score -= 15;

                    candidates.push({ el, score, text: elText.slice(0, 80), tag: tag.toLowerCase(), href: el.href || '' });

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
              return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: best.text, tag: best.tag, href: best.href };
            },
            args: [searchText]
          });

          if (!found) {
            sendResult(cmd, false, null, `No visible element found containing "${searchText}"`);
            break;
          }

          // Human-like click at the found coordinates
          const cdpOk = await canUseCDP(tabId);
          if (cdpOk) {
            const attached = await cdpAttach(tabId);
            if (attached) {
              try {
                await humanClick(tabId, found.x, found.y);
              } catch {
                // JS fallback
                await chrome.scripting.executeScript({
                  target: { tabId }, world: 'MAIN',
                  func: (x, y) => { const el = document.elementFromPoint(x, y); if (el) el.click(); },
                  args: [found.x, found.y]
                });
              }
            }
          } else {
            await chrome.scripting.executeScript({
              target: { tabId }, world: 'MAIN',
              func: (x, y) => { const el = document.elementFromPoint(x, y); if (el) el.click(); },
              args: [found.x, found.y]
            });
          }

          // Post-click: settle DOM + check URL change
          await settleDOM(tabId);
          let urlChanged = false;
          try { const ta = await chrome.tabs.get(tabId); urlChanged = ta.url !== urlBefore; } catch { urlChanged = true; }

          sendResult(cmd, true, { ok: true, clicked: found.text, tag: found.tag, urlChanged });
        } catch (err) {
          sendResult(cmd, false, null, err.message);
        }
        break;
      }

      /* ── Click by viewport coordinates (normalized 0-1) ── */
      case 'clickPoint': {
        const cdpOk = await canUseCDP(tabId);
        if (cdpOk) {
          const attached = await cdpAttach(tabId);
          if (attached) {
            try {
              const { result: vp } = await cdpSend(tabId, 'Runtime.evaluate', {
                expression: `({w: window.innerWidth, h: window.innerHeight})`,
                returnByValue: true
              });
              const px = Math.round((cmd.x || 0) * (vp?.value?.w || 1280));
              const py = Math.round((cmd.y || 0) * (vp?.value?.h || 720));
              const { clickX, clickY } = await humanClick(tabId, px, py);
              sendResult(cmd, true, { ok: true, x: clickX, y: clickY });
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

      /* ── Type into editor — atomic click-placeholder → find-editor → type (Reddit, LinkedIn, etc.) ── */
      /* ── Click overflow/three-dot menu near content, then click a menu item ── */
      case 'clickOverflowMenu': {
        const nearText = (cmd.nearText || '').trim();
        const menuAction = (cmd.menuAction || '').trim();
        if (!menuAction) { sendResult(cmd, false, null, 'No menuAction specified'); break; }

        try {
          // Step 1: Find the overflow button for the specific content via DOM hierarchy
          // Key insight: pixel distance is unreliable on Reddit — use DOM containment instead
          const [{ result: menuBtn }] = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (nearText) => {
              function isOverflowBtn(el) {
                const label = (el.getAttribute('aria-label') || '').toLowerCase();
                const text = (el.textContent || '').trim().toLowerCase();
                const tag = el.tagName;
                if (tag !== 'BUTTON' && el.getAttribute('role') !== 'button') return false;
                return label.includes('more') || label.includes('option') || label.includes('overflow') ||
                       label.includes('menu') || label.includes('action') ||
                       text === '...' || text === '⋯' || text === '⋮' || text === '…' ||
                       (text === '' && el.querySelector('svg') && el.getBoundingClientRect().width < 50);
              }

              // Strategy 1: DOM HIERARCHY — find a COMMON ANCESTOR that contains both
              // the comment text AND an overflow button. This is the most reliable method.
              if (nearText) {
                function findInHierarchy(root, depth) {
                  if (depth > 12) return null;
                  try {
                    for (const el of root.querySelectorAll('*')) {
                      const t = (el.textContent || '').trim();
                      // Find element that contains the nearText
                      if (!t.toLowerCase().includes(nearText.toLowerCase())) continue;
                      if (t.length > 2000) continue; // too big, not specific enough

                      // Walk UP the DOM to find a container that ALSO has an overflow button
                      let container = el;
                      for (let i = 0; i < 15 && container; i++) {
                        // Search this container (and its shadow children) for overflow buttons
                        const btns = [];
                        function findBtns(r, d) {
                          if (d > 6) return;
                          try {
                            for (const b of r.querySelectorAll('button, [role="button"]')) {
                              if (isOverflowBtn(b)) {
                                const rect = b.getBoundingClientRect();
                                if (rect.width > 0 && rect.height > 0) btns.push(b);
                              }
                            }
                            for (const c of r.querySelectorAll('*')) {
                              if (c.shadowRoot) findBtns(c.shadowRoot, d + 1);
                            }
                          } catch {}
                        }
                        findBtns(container, 0);
                        if (container.shadowRoot) findBtns(container.shadowRoot, 0);

                        if (btns.length > 0) {
                          const btn = btns[btns.length - 1];
                          btn.scrollIntoView({ block: 'center', behavior: 'instant' });
                          // NO .click() here — only return coordinates for CDP trusted click
                          const r = btn.getBoundingClientRect();
                          return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, label: (btn.getAttribute('aria-label') || 'menu'), method: 'hierarchy' };
                        }

                        // Go up — check parent, or if in shadow DOM, go to host
                        container = container.parentElement || (container.getRootNode() instanceof ShadowRoot ? container.getRootNode().host : null);
                      }
                    }
                    // Walk shadow roots
                    for (const el of root.querySelectorAll('*')) {
                      if (el.shadowRoot) { const f = findInHierarchy(el.shadowRoot, depth + 1); if (f) return f; }
                    }
                  } catch {}
                  return null;
                }
                const hierarchyResult = findInHierarchy(document, 0);
                if (hierarchyResult) return hierarchyResult;
              }

              // Strategy 2: Fallback to finding ALL buttons and picking closest by position
              const buttons = [];
              function findAll(root, depth) {
                if (depth > 12) return;
                try {
                  for (const el of root.querySelectorAll('button, [role="button"]')) {
                    if (isOverflowBtn(el)) {
                      const rect = el.getBoundingClientRect();
                      if (rect.width > 0 && rect.height > 0) buttons.push({ el, rect });
                    }
                  }
                  for (const el of root.querySelectorAll('*')) {
                    if (el.shadowRoot) findAll(el.shadowRoot, depth + 1);
                  }
                } catch {}
              }
              findAll(document, 0);
              if (buttons.length === 0) return { ok: false, error: 'No overflow buttons found on page' };

              // Pick the last visible one (usually the closest to the bottom comment)
              const btn = buttons[buttons.length - 1];
              btn.el.scrollIntoView({ block: 'center', behavior: 'instant' });
              // NO .click() — CDP only
              const r = btn.el.getBoundingClientRect();
              return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, label: 'menu', method: 'fallback' };
            },
            args: [nearText]
          });

          if (!menuBtn?.ok) {
            sendResult(cmd, false, null, menuBtn?.error || 'Could not find overflow menu button');
            break;
          }

          // CDP click for isTrusted
          const cdpOk = await canUseCDP(tabId);
          if (cdpOk) {
            const attached = await cdpAttach(tabId);
            if (attached) { try { await humanClick(tabId, menuBtn.x, menuBtn.y); } catch {} }
          }

          // Step 2+3: Wait for menu and find the action — POLLING RETRY (menu animations vary)
          let actionResult = null;
          for (let attempt = 0; attempt < 4; attempt++) {
            await new Promise(r => setTimeout(r, attempt === 0 ? 600 : 500));

            const [{ result: ar }] = await chrome.scripting.executeScript({
              target: { tabId }, world: 'MAIN',
              func: (actionText) => {
                const candidates = [];
                const actionLower = actionText.toLowerCase();

                function scanAll(root, depth) {
                  if (depth > 12) return;
                  try {
                    for (const el of root.querySelectorAll('*')) {
                      const text = (el.textContent || '').trim();
                      if (!text.toLowerCase().includes(actionLower)) continue;
                      if (text.length > 200) continue;
                      const rect = el.getBoundingClientRect();
                      if (rect.width === 0 || rect.height === 0) continue;
                      if (rect.top < -100 || rect.top > window.innerHeight + 100) continue;
                      try { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden') continue; } catch { continue; }

                      let score = 0;
                      const tag = el.tagName;
                      const role = el.getAttribute('role');
                      if (role === 'menuitem') score += 20;
                      if (role === 'option') score += 15;
                      if (tag === 'BUTTON') score += 10;
                      if (tag === 'A') score += 8;
                      if (tag === 'LI') score += 5;
                      score += Math.max(0, 10 - Math.floor(text.length / 20));
                      if (text.toLowerCase() === actionLower) score += 15;
                      if (text.toLowerCase().startsWith(actionLower)) score += 10;
                      if (rect.width < 400 && rect.height < 60) score += 5;
                      // Bonus: element has click handler or is a link/button child of a menu
                      if (el.onclick || el.closest('[role="menu"],[role="listbox"]')) score += 10;

                      candidates.push({ el, text: text.slice(0, 80), score, r: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } });
                      if (el.shadowRoot) scanAll(el.shadowRoot, depth + 1);
                    }
                  } catch {}
                }
                scanAll(document, 0);

                if (candidates.length === 0) return { ok: false, error: 'Menu item "' + actionText + '" not found (attempt)' };
                candidates.sort((a, b) => b.score - a.score);
                const best = candidates[0];
                // NO .click() — return coordinates for CDP trusted click only
                return { ok: true, clicked: best.text, x: best.r.x, y: best.r.y };
              },
              args: [menuAction]
            });
            actionResult = ar;
            if (ar?.ok) break;
          }

          if (!actionResult) actionResult = { ok: false, error: 'Menu scan returned no result' };

          if (!actionResult?.ok) {
            sendResult(cmd, false, null, actionResult?.error || 'Could not find menu action');
            break;
          }

          // CDP click for isTrusted — MANDATORY (JS clicks don't work on Reddit)
          await cdpAttach(tabId);
          await humanClick(tabId, actionResult.x, actionResult.y);

          // Step 4: Handle confirmation dialog — polling retry
          let confirmResult = { ok: true, confirmed: false };
          for (let ca = 0; ca < 3; ca++) {
            await new Promise(r => setTimeout(r, ca === 0 ? 800 : 500));
            const [{ result: cr }] = await chrome.scripting.executeScript({
              target: { tabId }, world: 'MAIN',
              func: (actionText) => {
                const confirmWords = [actionText.toLowerCase(), 'yes', 'confirm', 'ok', 'delete'];
                function scan(root, depth) {
                  if (depth > 12) return null;
                  try {
                    // Scan ALL elements — dialogs can be anywhere
                    for (const el of root.querySelectorAll('*')) {
                      const tag = el.tagName;
                      const role = el.getAttribute('role');
                      if (tag !== 'BUTTON' && role !== 'button' && tag !== 'A') continue;
                      const text = (el.textContent || '').trim().toLowerCase();
                      if (!confirmWords.some(w => text.includes(w))) continue;
                      const r = el.getBoundingClientRect();
                      if (r.width > 0 && r.height > 0 && r.top >= 0 && r.top < window.innerHeight) {
                        // NO .click() — CDP only
                        return { ok: true, confirmed: text, x: r.left + r.width / 2, y: r.top + r.height / 2 };
                      }
                    }
                    for (const el of root.querySelectorAll('*')) {
                      if (el.shadowRoot) { const f = scan(el.shadowRoot, depth + 1); if (f) return f; }
                    }
                  } catch {}
                  return null;
                }
                return scan(document, 0) || { ok: true, confirmed: false };
              },
              args: [menuAction]
            });
            if (cr?.confirmed) {
              confirmResult = cr;
              // CDP trusted click — mandatory
              await humanClick(tabId, cr.x, cr.y);
              break;
            }
          }

          sendResult(cmd, true, {
            ok: true,
            menuClicked: menuBtn.label,
            actionClicked: actionResult.clicked,
            confirmed: confirmResult?.confirmed || false,
          });
        } catch (err) {
          sendResult(cmd, false, null, err.message);
        }
        break;
      }

      case 'typeIntoEditor': {
        const editorText = cmd.text || '';
        const placeholderHint = cmd.placeholder || 'Join the conversation';
        if (!editorText) { sendResult(cmd, false, null, 'No text to type'); break; }

        try {
          const cdpOk = await canUseCDP(tabId);
          const attached = cdpOk ? await cdpAttach(tabId) : false;

          // Step 1: Find and click the placeholder/editor via MAIN world (walks all shadow DOMs)
          const [{ result: clickResult }] = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (hint) => {
              // Deep search through shadow DOM for the placeholder or editor
              function findTarget(root, depth) {
                if (depth > 12) return null;
                try {
                  // Look for contenteditable first (editor already open)
                  for (const el of root.querySelectorAll('[contenteditable="true"], [contenteditable=""], textarea, .ProseMirror, .ql-editor, [role="textbox"]')) {
                    const r = el.getBoundingClientRect();
                    if (r.width > 50 && r.height > 10) {
                      try { if (getComputedStyle(el).display === 'none') continue; } catch {}
                      return el;
                    }
                  }
                  // Look for placeholder text
                  for (const el of root.querySelectorAll('*')) {
                    const text = (el.textContent || '').trim();
                    if (text.toLowerCase().includes(hint.toLowerCase()) && text.length < 200) {
                      const r = el.getBoundingClientRect();
                      if (r.width > 50 && r.height > 10) return el;
                    }
                  }
                  // Walk shadow roots
                  for (const el of root.querySelectorAll('*')) {
                    if (el.shadowRoot) {
                      const found = findTarget(el.shadowRoot, depth + 1);
                      if (found) return found;
                    }
                  }
                } catch {}
                return null;
              }
              const target = findTarget(document, 0);
              if (!target) return { ok: false, error: 'No editor or placeholder found' };
              target.scrollIntoView({ block: 'center', behavior: 'instant' });
              target.click();
              const r = target.getBoundingClientRect();
              return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, tag: target.tagName.toLowerCase() };
            },
            args: [placeholderHint]
          });

          if (!clickResult?.ok) {
            sendResult(cmd, false, null, clickResult?.error || 'Could not find editor placeholder');
            break;
          }

          // Also do a CDP click at the coordinates for isTrusted:true
          if (attached) {
            try { await humanClick(tabId, clickResult.x, clickResult.y); } catch {}
          }

          // Step 2: Wait for editor to fully load
          await new Promise(r => setTimeout(r, 1200));

          // Step 3: Find the now-active contenteditable and focus it
          const [{ result: focusResult }] = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: () => {
              function findEditor(root, depth) {
                if (depth > 12) return null;
                try {
                  for (const el of root.querySelectorAll('[contenteditable="true"], [contenteditable=""], textarea, .ProseMirror, .ql-editor')) {
                    const r = el.getBoundingClientRect();
                    if (r.width > 50 && r.height > 10) {
                      try { if (getComputedStyle(el).display === 'none') continue; } catch {}
                      el.focus();
                      // Click inside the editor to ensure cursor placement
                      el.click();
                      return { ok: true, tag: el.tagName, editable: el.isContentEditable, r: { x: r.left + r.width / 2, y: r.top + r.height / 2 } };
                    }
                  }
                  for (const el of root.querySelectorAll('*')) {
                    if (el.shadowRoot) {
                      const found = findEditor(el.shadowRoot, depth + 1);
                      if (found) return found;
                    }
                  }
                } catch {}
                return null;
              }
              return findEditor(document, 0) || { ok: false };
            },
            args: []
          });

          // CDP click on the editor too (for isTrusted focus)
          if (attached && focusResult?.r) {
            try { await humanClick(tabId, focusResult.r.x, focusResult.r.y); } catch {}
            await new Promise(r => setTimeout(r, 300));
          }

          // Step 4: Type using browser-use's proven 3-method cascade
          if (attached) {
            // Method A: CDP Input.insertText (atomic, works for most inputs)
            await cdpSend(tabId, 'Input.insertText', { text: editorText });
            await new Promise(r => setTimeout(r, 300));

            // Verify
            const [{ result: checkA }] = await chrome.scripting.executeScript({
              target: { tabId }, world: 'MAIN',
              func: () => {
                function find(root, d) {
                  if (d > 12) return null;
                  try {
                    for (const el of root.querySelectorAll('[contenteditable="true"],[contenteditable=""],textarea,.ProseMirror')) {
                      const t = el.isContentEditable ? (el.innerText || '').trim() : (el.value || '').trim();
                      if (t.length > 0) return true;
                    }
                    for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) { const f = find(el.shadowRoot, d+1); if (f) return f; } }
                  } catch {} return null;
                }
                return find(document, 0) || false;
              }, args: []
            });

            if (!checkA?.result) {
              // Method B: browser-use char-by-char (keyDown NO text + char WITH text + keyUp)
              await cdpTypeText(tabId, editorText, randInt(1, 5));
              await new Promise(r => setTimeout(r, 200));

              // Verify again
              const [{ result: checkB }] = await chrome.scripting.executeScript({
                target: { tabId }, world: 'MAIN',
                func: () => {
                  function find(root, d) {
                    if (d > 12) return null;
                    try {
                      for (const el of root.querySelectorAll('[contenteditable="true"],[contenteditable=""],textarea,.ProseMirror')) {
                        const t = el.isContentEditable ? (el.innerText || '').trim() : (el.value || '').trim();
                        if (t.length > 0) return true;
                      }
                      for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) { const f = find(el.shadowRoot, d+1); if (f) return f; } }
                    } catch {} return null;
                  }
                  return find(document, 0) || false;
                }, args: []
              });

              if (!checkB?.result) {
                // Method C: JS execCommand fallback (last resort)
                await chrome.scripting.executeScript({
                  target: { tabId }, world: 'MAIN',
                  func: (text) => {
                    function find(root, d) {
                      if (d > 12) return null;
                      try {
                        for (const el of root.querySelectorAll('[contenteditable="true"],[contenteditable=""],textarea,.ProseMirror')) {
                          if (el.getBoundingClientRect().width > 50) { el.focus(); return el; }
                        }
                        for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) { const f = find(el.shadowRoot, d+1); if (f) return f; } }
                      } catch {} return null;
                    }
                    const el = find(document, 0);
                    if (el && el.isContentEditable) { el.focus(); document.execCommand('insertText', false, text); }
                    else if (el) { el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); }
                  },
                  args: [editorText]
                });
              }
            }
          } else {
            // No CDP — JS only
            await chrome.scripting.executeScript({
              target: { tabId }, world: 'MAIN',
              func: (text) => {
                const el = document.activeElement;
                if (el && el.isContentEditable) { document.execCommand('insertText', false, text); }
                else if (el) { el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); }
              },
              args: [editorText]
            });
          }

          // Step 5: Verify
          await new Promise(r => setTimeout(r, 300));
          const [{ result: verifyResult }] = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: () => {
              function checkEditor(root, depth) {
                if (depth > 12) return null;
                try {
                  for (const el of root.querySelectorAll('[contenteditable="true"], [contenteditable=""], textarea, .ProseMirror')) {
                    const text = el.isContentEditable ? (el.innerText || '').trim() : (el.value || '').trim();
                    if (text.length > 0) return { ok: true, content: text.slice(0, 100) };
                  }
                  for (const el of root.querySelectorAll('*')) {
                    if (el.shadowRoot) { const f = checkEditor(el.shadowRoot, depth + 1); if (f) return f; }
                  }
                } catch {}
                return null;
              }
              return checkEditor(document, 0) || { ok: false };
            },
            args: []
          });

          sendResult(cmd, true, {
            ok: true,
            typed: editorText,
            verified: verifyResult?.ok || false,
            content: verifyResult?.content || '',
            editorFound: focusResult?.ok || false,
          });
        } catch (err) {
          sendResult(cmd, false, null, err.message);
        }
        break;
      }

      /* ── Type ── */
      case 'type': {
        const cdpOk = await canUseCDP(tabId);
        if (cdpOk) {
          const attached = await cdpAttach(tabId);
          if (attached) {
            if (!sessions.get(tabId)?.elementIndex) await refreshElementIndex(tabId);
            try {
              const result = await handleType(tabId, cmd.selector, cmd.text);
              sendResult(cmd, result?.ok !== false, result, result?.error);
              break;
            } catch (err) {
              console.error('CDP type failed, trying fallback:', err.message);
            }
          }
        }
        // DOM fallback
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
        // DOM fallback for typeChar
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
                  if (i >= text.length) { t.dispatchEvent(new Event('change', { bubbles: true, composed: true })); resolve({ ok: true }); return; }
                  const ch = text[i];
                  t.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, composed: true }));
                  if (isCE) document.execCommand('insertText', false, ch); else { const tr = t._valueTracker; if (tr) tr.setValue(t.value); t.value += ch; }
                  t.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: ch, inputType: 'insertText' }));
                  t.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true, composed: true }));
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

      /* ── Keypress ── */
      case 'keyPress': {
        const cdpOk = await canUseCDP(tabId);
        if (cdpOk) {
          const attached = await cdpAttach(tabId);
          if (attached) {
            try {
              const result = await handleKeypress(tabId, cmd.key);
              sendResult(cmd, true, result);
              break;
            } catch (err) { console.error('CDP keyPress failed:', err.message); }
          }
        }
        // Fallback
        try {
          await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (key) => {
              const el = document.activeElement || document.body;
              el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true }));
              el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, composed: true }));
            },
            args: [cmd.key]
          });
          sendResult(cmd, true, {});
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      /* ── Hover (human-like) ── */
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
            } catch (err) { console.error('CDP hover failed:', err.message); }
          }
        }
        sendResult(cmd, false, null, 'Hover requires CDP — ensure DevTools is not open on this tab');
        break;
      }

      /* ── Get elements (DOM snapshot) ── */
      case 'getElements':
      case 'getPageInfo': {
        const cdpOk = await canUseCDP(tabId);
        if (cdpOk) {
          const attached = await cdpAttach(tabId);
          if (attached) {
            try {
              const result = await handleGetElements(tabId);
              sendResult(cmd, true, result);
              break;
            } catch (err) {
              console.error('CDP getElements failed:', err.message);
            }
          }
        }
        // Fallback: use content script
        try {
          await ensureContentScript(tabId);
          const result = await sendToContent(tabId, { action: 'getElements' });
          sendResult(cmd, true, result);
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      /* ── Screenshot ── */
      case 'screenshot': {
        try {
          const tab = tabId ? await chrome.tabs.get(tabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
          if (!tab) { sendResult(cmd, false, null, 'No tab to screenshot'); break; }
          const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: SCREENSHOT_QUALITY });
          sendResult(cmd, true, { dataUrl, url: tab.url, title: tab.title });
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      /* ── Scroll ── */
      case 'scroll': {
        await ensureContentScript(tabId);
        try {
          const result = await sendToContent(tabId, { action: 'scroll', selector: cmd.selector, x: cmd.x || 0, y: cmd.y || 0 });
          sendResult(cmd, true, result);
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      /* ── Select (dropdown) ── */
      case 'select': {
        try {
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (selector, value) => {
              const el = document.querySelector(selector);
              if (!el || el.tagName !== 'SELECT') return { ok: false, error: 'Select element not found' };
              el.value = value;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { ok: true };
            },
            args: [cmd.selector, cmd.value]
          });
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

      /* ── Evaluate JS ── */
      case 'evaluate': {
        try {
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (code) => { try { return { ok: true, result: eval(code) }; } catch (e) { return { ok: false, error: e.message }; } },
            args: [cmd.code || cmd.expression]
          });
          sendResult(cmd, result?.ok !== false, result, result?.error);
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      /* ── Tab management ── */
      case 'newTab': {
        let url = cmd.url;
        if (url && !url.startsWith('http') && !url.startsWith('file:')) url = 'https://' + url;

        // Smart tab reuse: if a tab with the same domain already exists, navigate it instead
        if (url) {
          try {
            const targetHost = new URL(url).hostname;
            const allTabs = await chrome.tabs.query({});
            const existingTab = allTabs.find(t => {
              if (!t.url || isProtectedTab(t)) return false;
              try { return new URL(t.url).hostname === targetHost; } catch { return false; }
            });
            if (existingTab) {
              await chrome.tabs.update(existingTab.id, { url, active: true });
              await waitForPageLoad(existingTab.id);
              await ensureContentScript(existingTab.id);
              lastAgentTabId = existingTab.id;
              streamingTabId = existingTab.id;
              if (!sessions.has(existingTab.id)) {
                sessions.set(existingTab.id, { queue: [], running: false, elementIndex: null, mouseX: rand(100, 400), mouseY: rand(100, 300) });
              }
              const tab = await chrome.tabs.get(existingTab.id);
              sendResult(cmd, true, { tabId: existingTab.id, url: tab.url, title: tab.title, reused: true });
              break;
            }
          } catch {}
        }

        const newTab = await chrome.tabs.create({ url: url || 'about:blank', active: true });
        if (url) await waitForPageLoad(newTab.id);
        await ensureContentScript(newTab.id);
        lastAgentTabId = newTab.id;
        streamingTabId = newTab.id;
        sessions.set(newTab.id, { queue: [], running: false, elementIndex: null, mouseX: rand(100, 400), mouseY: rand(100, 300) });
        const tab = await chrome.tabs.get(newTab.id);
        sendResult(cmd, true, { tabId: newTab.id, url: tab.url, title: tab.title });
        break;
      }

      case 'getTabList': {
        const tabs = await chrome.tabs.query({});
        sendResult(cmd, true, { tabs: tabs.filter(t => !isProtectedTab(t)).map(t => ({ tabId: t.id, url: t.url, title: t.title, active: t.active })) });
        break;
      }

      case 'switchTab': {
        try {
          await chrome.tabs.update(cmd.targetTabId || cmd.tabId, { active: true });
          streamingTabId = cmd.targetTabId || cmd.tabId;
          sendResult(cmd, true, {});
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      case 'closeTab': {
        try {
          await chrome.tabs.remove(cmd.targetTabId || tabId);
          sendResult(cmd, true, {});
        } catch (err) { sendResult(cmd, false, null, err.message); }
        break;
      }

      /* ── Connection check ── */
      case 'checkConnection': {
        sendResult(cmd, true, { status, connected: status === 'connected' });
        break;
      }

      /* ── Set streaming tab ── */
      case 'setStreamingTab': {
        streamingTabId = cmd.targetTabId || tabId;
        sendResult(cmd, true, {});
        break;
      }

      default:
        sendResult(cmd, false, null, `Unknown action: ${cmd.action}`);
    }
  } catch (err) {
    sendResult(cmd, false, null, err.message || 'Unknown error');
  }
}

/* ══════════════════════════════════════════════════════════
 *  POPUP MESSAGE HANDLER
 * ══════════════════════════════════════════════════════════ */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'getStatus') {
    sendResponse({ status, error: lastError, tabCount: sessions.size });
    return false;
  }
  if (msg.type === 'connect') {
    connect();
    sendResponse({ status, error: lastError });
    return false;
  }
  if (msg.type === 'disconnect') {
    disconnect();
    sendResponse({ status: 'disconnected', error: '' });
    return false;
  }
  return false;
});

/* ── Auto-connect on startup ── */
connect();
