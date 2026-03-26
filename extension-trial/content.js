/**
 * content.js — Browser automation v4
 *
 * ARCHITECTURE:
 * - Content script (ISOLATED world): ONLY handles scanning/observation
 * - All interactions (click, type) happen via background.js → executeScript(MAIN world)
 * - This separation ensures events use the page's JS constructors
 *
 * Shadow DOM: Recursively walks open shadow roots to find ALL elements
 * Element tagging: Every element gets data-psh-id for cross-world referencing
 */
(() => {
  let elementMap = new Map();
  let nextId = 1;

  const SELECTORS = [
    'button:not([disabled])',
    'a[href]',
    'input:not([type=hidden])',
    'select',
    'textarea',
    '[role="button"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="textbox"]',
    '[role="combobox"]',
    '[role="searchbox"]',
    '[role="switch"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[contenteditable="true"]',
    '[contenteditable=""]',
    'details > summary',
  ].join(', ');

  /* ── Visibility ── */
  function isVisible(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return false;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    try {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    } catch { return false; }
    return true;
  }

  /* ── Label extraction — handles shadow DOM slotted content ── */
  function getLabel(el) {
    // 1. Check attributes first (fast, reliable)
    for (const attr of ['aria-label', 'title', 'placeholder', 'data-testid', 'data-click-id', 'alt', 'name']) {
      const v = el.getAttribute(attr);
      if (v && v.trim()) return v.trim().replace(/[\n\r\t]+/g, ' ').slice(0, 60);
    }

    // 2. innerText — works for most elements including slotted content
    const text = (el.innerText || '').trim();
    if (text && text.length <= 80) return text.replace(/\s+/g, ' ').slice(0, 60);

    // 3. textContent — catches text nodes that innerText might miss
    const tc = (el.textContent || '').trim();
    if (tc && tc.length <= 80 && tc.length > 0) return tc.replace(/\s+/g, ' ').slice(0, 60);

    // 4. For buttons with only SVG icons, check svg icon-name
    try {
      const svg = el.querySelector('svg[icon-name]');
      if (svg) return svg.getAttribute('icon-name');
    } catch {}

    // 5. Check children's shadow roots for slotted text (Reddit's faceplate-screen-reader-content)
    try {
      for (const child of el.querySelectorAll('*')) {
        if (child.shadowRoot) {
          const slotText = (child.textContent || '').trim();
          if (slotText && slotText.length <= 60) return slotText.replace(/\s+/g, ' ');
        }
        // Also check direct text content of custom elements
        if (child.tagName.includes('-')) {
          const ct = (child.textContent || '').trim();
          if (ct && ct.length <= 60) return ct.replace(/\s+/g, ' ');
        }
      }
    } catch {}

    // 6. Input value
    if (el.value && typeof el.value === 'string') return el.value.slice(0, 60);

    // 7. Check for upvote/downvote HTML attributes (Reddit specific)
    if (el.hasAttribute('upvote')) return 'Upvote';
    if (el.hasAttribute('downvote')) return 'Downvote';

    return '';
  }

  /* ── Role ── */
  function getRole(el) {
    const role = el.getAttribute('role');
    if (role) return role;
    const tag = el.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a') return 'link';
    if (tag === 'input') return el.type || 'input';
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    if (tag === 'summary') return 'button';
    if (el.isContentEditable) return 'textbox';
    return tag;
  }

  /* ── Shadow DOM recursive collection ── */
  function collectElements(root, results, depth) {
    if (depth > 8) return;

    let nodes = [];
    try { nodes = [...root.querySelectorAll(SELECTORS)]; } catch {}

    for (const el of nodes) {
      if (!isVisible(el)) continue;
      const label = getLabel(el);
      if (!label) continue;  // Skip unlabeled elements — they waste slots and confuse the LLM
      results.push({ el, label, depth });
      if (el.shadowRoot) collectElements(el.shadowRoot, results, depth + 1);
    }

    // Walk ALL elements for shadow hosts not in our selector list
    try {
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) collectElements(el.shadowRoot, results, depth + 1);
      }
    } catch {}
  }

  /* ── Rebuild element map — ZERO DOM MODIFICATIONS ── */
  // This is critical: setting attributes during scan triggers MutationObserver
  // events that close dropdowns, menus, and modals on most sites.
  // Instead, we store elements only in the JS Map and use coordinates for clicks.
  function rebuildElementMap() {
    elementMap = new Map();
    nextId = 1;

    const results = [];
    collectElements(document, results, 0);

    // Deduplicate
    const seen = new WeakSet();
    const unique = results.filter(({ el }) => {
      if (seen.has(el)) return false;
      seen.add(el);
      return true;
    });

    // Prioritize: menuitems and action buttons first (they're in open dropdowns),
    // then buttons/inputs, then links. This ensures dropdown menu items
    // aren't cut off by the element limit.
    function priority(item) {
      const el = item.el;
      const role = el.getAttribute('role');
      const tag = el.tagName.toLowerCase();
      if (role === 'menuitem') return 0;  // highest priority — dropdown items
      if (tag === 'button' || role === 'button') return 1;
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable) return 1;
      if (tag === 'summary') return 1;
      if (tag === 'a') return 2;  // links are lowest priority
      return 1;
    }

    // Sort: priority first, then vertical position within same priority
    unique.sort((a, b) => {
      const pa = priority(a);
      const pb = priority(b);
      if (pa !== pb) return pa - pb;
      return a.el.getBoundingClientRect().top - b.el.getBoundingClientRect().top;
    });

    // Take top 80 elements (increased from 60 to avoid cutting off important items)
    const tagged = [];
    for (const item of unique.slice(0, 80)) {
      const id = nextId++;
      elementMap.set(id, item);
      tagged.push({ id, ...item });
    }
    return tagged;
  }

  /**
   * Get nearby text context for an element (helps LLM understand what the button is for).
   * E.g. an upvote button near "D-Ribose • 1mo ago" tells the LLM which comment it belongs to.
   */
  function getNearbyContext(el) {
    // Walk up to find the nearest container with meaningful text
    let parent = el.parentElement;
    for (let i = 0; i < 5 && parent; i++) {
      // Look for username, timestamp, or post title near this element
      const texts = [];
      // Check siblings and close relatives for context clues
      for (const child of parent.children) {
        if (child === el) continue;
        const t = (child.innerText || '').trim().replace(/\s+/g, ' ');
        if (t && t.length > 1 && t.length < 80 && !/^\d+$/.test(t)) {
          texts.push(t.slice(0, 40));
        }
        if (texts.length >= 2) break;
      }
      if (texts.length > 0) return texts.join(' | ');
      parent = parent.parentElement;
    }
    return '';
  }

  /* ── Build compact text snapshot with section grouping ── */
  function buildSnapshot(includePageText) {
    const tagged = rebuildElementMap();
    const lines = [];
    lines.push(`PAGE: ${location.href}`);
    lines.push(`TITLE: ${document.title}`);

    if (includePageText) {
      const text = (document.body.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 1500);
      lines.push(`TEXT: ${text}`);
    }

    // Group elements by vertical proximity (elements within 50px are in the same group)
    lines.push(`\nELEMENTS (use [data-psh-id="N"] as selector):`);

    let lastTop = -999;
    for (const { id, el, label, depth } of tagged) {
      const role = getRole(el);
      const tag = el.tagName.toLowerCase();
      const shadow = depth > 0 ? ` [shadow:${depth}]` : '';
      const focused = (el === document.activeElement) ? ' ← focused' : '';
      const rect = el.getBoundingClientRect();

      // Insert section break for elements far apart vertically
      if (rect.top - lastTop > 100) {
        lines.push('---'); // visual separator between page sections
      }
      lastTop = rect.top;

      let desc = `  [${id}] ${role} "${label}"${shadow}${focused}`;

      // Inputs: show placeholder, value, type
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable) {
        const ph = el.getAttribute('placeholder');
        if (ph) desc += ` placeholder="${ph}"`;
        const val = el.isContentEditable ? (el.innerText || '').trim() : (el.value || '');
        if (val) desc += ` value="${val.slice(0, 50)}"`;
        if (el.type && el.type !== 'text') desc += ` type=${el.type}`;
      }

      // Links: show path
      if (tag === 'a' && el.href) {
        try { desc += ` href=${new URL(el.href).pathname.slice(0, 60)}`; } catch {}
      }

      // Special button annotations
      if (el.hasAttribute('upvote')) desc += ' [UPVOTE-BTN]';
      if (el.hasAttribute('downvote')) desc += ' [DOWNVOTE-BTN]';
      const ariaPressed = el.getAttribute('aria-pressed');
      if (ariaPressed) desc += ` pressed=${ariaPressed}`;

      // Detect three-dot / action menu buttons (universal pattern)
      const lbl = label.toLowerCase();
      if (lbl.includes('more') || lbl.includes('actions') || lbl.includes('options') ||
          lbl === '...' || lbl === '⋯' || lbl === '⋮' ||
          el.getAttribute('aria-haspopup') === 'true' || el.getAttribute('aria-haspopup') === 'menu') {
        desc += ' [ACTION-MENU]';
      }

      // Nearby context for buttons (helps associate buttons with content)
      if (tag === 'button' || role === 'button' || role === 'menuitem') {
        const ctx = getNearbyContext(el);
        if (ctx) desc += ` near="${ctx}"`;
      }

      lines.push(desc);
    }

    return lines.join('\n');
  }

  /* ── Resolve element from ref — Map-first, no DOM query needed ── */
  function resolveElement(ref) {
    if (ref === undefined || ref === null) return null;
    if (typeof ref === 'number') {
      const entry = elementMap.get(ref);
      return entry ? entry.el : null;
    }
    if (typeof ref === 'string') {
      const trimmed = ref.trim();

      // Parse [data-psh-id="N"] → lookup in Map (primary path)
      const match = trimmed.match(/data-psh-id="(\d+)"/);
      if (match) {
        const id = parseInt(match[1], 10);
        const entry = elementMap.get(id);
        if (entry) return entry.el;
      }

      // Pure numeric string → Map lookup
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && String(num) === trimmed && elementMap.has(num)) {
        return elementMap.get(num).el;
      }

      // Fallback: CSS selector (for non-scan elements)
      try { return document.querySelector(trimmed); } catch {}
    }
    return null;
  }

  /* ── Wait for element (deep search) ── */
  function domWaitForElement(selector, timeout = 10000) {
    return new Promise((resolve) => {
      const start = Date.now();
      function poll() {
        let el = null;
        try { el = document.querySelector(selector); } catch {}
        if (!el) {
          // Deep search in shadow roots
          const results = [];
          collectElements(document, results, 0);
          for (const r of results) {
            if (r.label && r.label.toLowerCase().includes(selector.toLowerCase())) {
              el = r.el;
              break;
            }
          }
        }
        if (el && isVisible(el)) { resolve({ ok: true }); return; }
        if (Date.now() - start >= timeout) { resolve({ ok: false, error: `Timeout: ${selector}` }); return; }
        setTimeout(poll, 300);
      }
      poll();
    });
  }

  /* ── Wait for DOM settle ── */
  function waitForDOM(quietMs = 400, maxMs = 5000) {
    return new Promise((resolve) => {
      let timer;
      const bump = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { obs.disconnect(); resolve({ ok: true }); }, quietMs);
      };
      const obs = new MutationObserver(bump);
      obs.observe(document.body, { childList: true, subtree: true, attributes: true });
      bump();
      setTimeout(() => { clearTimeout(timer); obs.disconnect(); resolve({ ok: true }); }, maxMs);
    });
  }

  /** Quick DOM settle — wait for React/Lit re-renders to finish before scanning */
  function quickSettle() {
    return new Promise((resolve) => {
      let timer = setTimeout(resolve, 150); // default: 150ms is enough for most renders
      const obs = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => { obs.disconnect(); resolve(); }, 150);
      });
      obs.observe(document.body, { childList: true, subtree: true });
      // Hard cap at 1 second
      setTimeout(() => { clearTimeout(timer); obs.disconnect(); resolve(); }, 1000);
    });
  }

  /* ── Message handler — ONLY observation, no interactions ── */
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const action = msg.action || msg.type;

    switch (action) {
      case 'ping':
        sendResponse({ ok: true, url: location.href });
        return false;

      case 'getPageInfo':
        // Synchronous scan — no async waits that might close dropdowns/menus
        sendResponse({ snapshot: buildSnapshot(true) });
        return false;

      case 'getElements':
      case 'getInteractiveElements':
        // Synchronous scan — no async waits that might close dropdowns/menus
        sendResponse({ snapshot: buildSnapshot(false) });
        return false;

      // Prepare element for MAIN world interaction:
      // 1. Resolve from Map
      // 2. Scroll into view (skip for menu items — they're already visible in a popup)
      // 3. Tag element ONLY if it's safe (not inside a dropdown/menu)
      // 4. Return coordinates
      case 'getClickCoords': {
        const el = resolveElement(msg.selector);
        if (!el) { sendResponse({ x: null, y: null, tagged: false }); return false; }

        // Check if element is inside a dropdown/menu/popup
        // These elements are already visible — don't scroll or set attributes (causes dropdown to close)
        const isInMenu = el.getAttribute('role') === 'menuitem' ||
          el.closest?.('[role="menu"]') ||
          el.closest?.('[role="dialog"]') ||
          el.closest?.('[role="listbox"]') ||
          el.closest?.('[aria-haspopup]');

        if (!isInMenu) {
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
        }

        // Only tag if NOT in a menu — setting attributes on menu items closes the dropdown
        let tagged = false;
        if (!isInMenu) {
          try { el.setAttribute('data-psh-target', 'true'); tagged = true; } catch {}
        }

        const rect = el.getBoundingClientRect();
        // For menu items: pass the label text so MAIN world can find by text + role
        const entry = elementMap.get(parseInt((msg.selector.match(/data-psh-id="(\d+)"/) || [])[1], 10));
        const labelText = entry?.label || el.textContent?.trim()?.slice(0, 60) || '';
        const elRole = el.getAttribute('role') || '';

        sendResponse({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          tagged,
          isInMenu,
          labelText,
          elRole
        });
        return false;
      }

      case 'scroll': {
        if (msg.selector) {
          const el = resolveElement(msg.selector);
          if (!el) { sendResponse({ ok: false, error: `Not found: ${msg.selector}` }); return false; }
          el.scrollBy({ left: msg.x || 0, top: msg.y || 0, behavior: 'instant' });
        } else {
          window.scrollBy({ left: msg.x || 0, top: msg.y || 0, behavior: 'instant' });
        }
        sendResponse({ ok: true });
        return false;
      }

      case 'waitForElement':
        domWaitForElement(msg.selector, msg.timeout || 10000).then(sendResponse);
        return true;

      case 'getAttribute': {
        const el = resolveElement(msg.selector);
        if (!el) { sendResponse({ ok: false, error: `Not found: ${msg.selector}` }); return false; }
        sendResponse({ ok: true, value: el.getAttribute(msg.attribute) ?? el[msg.attribute] ?? null });
        return false;
      }

      case 'waitForDOM':
        waitForDOM(msg.quietMs || 400, msg.maxMs || 5000).then(sendResponse);
        return true;

      default:
        sendResponse({ ok: false, error: `Unknown action: ${action}` });
        return false;
    }
  });
})();
