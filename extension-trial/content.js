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
    '[tabindex]:not([tabindex="-1"])',
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
      if (v && v.trim()) return v.trim().replace(/[\n\r\t]+/g, ' ').slice(0, 80);
    }

    // 2. innerText — ALWAYS truncate, never discard long text
    // LinkedIn conversation items have long innerText — we need the first ~80 chars
    const text = (el.innerText || '').trim();
    if (text) return text.replace(/\s+/g, ' ').slice(0, 80);

    // 3. textContent — catches text nodes that innerText might miss
    const tc = (el.textContent || '').trim();
    if (tc) return tc.replace(/\s+/g, ' ').slice(0, 80);

    // 4. For buttons with only SVG icons, check svg icon-name
    try {
      const svg = el.querySelector('svg[icon-name]');
      if (svg) return svg.getAttribute('icon-name');
    } catch {}

    // 5. Check children's shadow roots for slotted text
    try {
      for (const child of el.querySelectorAll('*')) {
        if (child.shadowRoot) {
          const slotText = (child.textContent || '').trim();
          if (slotText) return slotText.replace(/\s+/g, ' ').slice(0, 80);
        }
        if (child.tagName.includes('-')) {
          const ct = (child.textContent || '').trim();
          if (ct) return ct.replace(/\s+/g, ' ').slice(0, 80);
        }
      }
    } catch {}

    // 6. Input value
    if (el.value && typeof el.value === 'string') return el.value.slice(0, 80);

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
    // Elements with tabindex but no semantic role — these are clickable items
    // (e.g., LinkedIn conversation items, custom card components)
    if (el.tabIndex >= 0 && ['DIV', 'LI', 'SPAN', 'SECTION', 'ARTICLE'].includes(el.tagName)) return 'clickable';
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

    // Prioritize: inputs/editors highest (always needed), then menuitems (dropdowns),
    // then buttons, then tabindex clickables, then links, then action menus lowest.
    function priority(item) {
      const el = item.el;
      const role = el.getAttribute('role');
      const tag = el.tagName.toLowerCase();
      // Highest: inputs, textareas, contenteditable — always include these
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable ||
          role === 'textbox' || role === 'combobox' || role === 'searchbox') return 0;
      if (role === 'menuitem') return 0;  // dropdown items — critical when menu is open
      // Deprioritize action menu / three-dot buttons
      const lbl = (item.label || '').toLowerCase();
      const hasPopup = el.getAttribute('aria-haspopup');
      const isActionMenu = lbl.includes('more') || lbl.includes('actions') || lbl.includes('options list') ||
        lbl === '...' || lbl === '⋯' || lbl === '⋮' ||
        hasPopup === 'true' || hasPopup === 'menu';
      if (isActionMenu) return 4;  // lowest — rarely the right target
      if (tag === 'button' || role === 'button') return 1;
      if (tag === 'summary') return 1;
      // Tabindex clickables (LinkedIn conversation items, etc.) — important!
      if (el.tabIndex >= 0 && !['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return 1;
      if (tag === 'a') return 2;
      return 2;
    }

    // Sort: priority first, then vertical position within same priority
    unique.sort((a, b) => {
      const pa = priority(a);
      const pb = priority(b);
      if (pa !== pb) return pa - pb;
      return a.el.getBoundingClientRect().top - b.el.getBoundingClientRect().top;
    });

    // Take top 120 elements (increased to handle complex pages like LinkedIn messaging)
    rebuildElementMap.lastTotalCount = unique.length;
    const tagged = [];
    for (const item of unique.slice(0, 60)) {
      const id = nextId++;
      elementMap.set(id, item);
      tagged.push({ id, ...item });
    }
    return tagged;
  }
  rebuildElementMap.lastTotalCount = 0;

  /**
   * Get smart nearby context — prefers usernames, timestamps, headings over raw numbers.
   * E.g. an upvote button near "Motor-Supermarket187 • 1m ago" tells the LLM which comment it belongs to.
   */
  function getSmartContext(el) {
    // Patterns that indicate useful context (usernames, timestamps, headings)
    const TIME_RE = /\d+\s*(m|h|d|mo|yr|min|hour|day|sec|week|month|year)\w*\s*ago/i;
    const USER_RE = /^[A-Za-z0-9_-]{3,25}$/;
    // Patterns to skip — pure numbers, vote counts, generic noise
    const SKIP_RE = /^[\d,.]+[kKmM]?$|^(vote|point|comment|share|award|reply|more|save)\w*$/i;

    let parent = el.parentElement;
    // Also check across shadow boundary
    if (!parent) {
      const root = el.getRootNode();
      if (root instanceof ShadowRoot) parent = root.host?.parentElement;
    }

    for (let i = 0; i < 6 && parent; i++) {
      const parts = [];

      for (const child of parent.children) {
        if (child === el || child.contains(el)) continue;
        const t = (child.innerText || child.textContent || '').trim().replace(/\s+/g, ' ');
        if (!t || t.length < 2 || t.length > 100) continue;
        if (SKIP_RE.test(t)) continue;

        // Prefer: links (often usernames), time elements, headings
        const tag = child.tagName?.toLowerCase();
        const isHighValue = tag === 'a' || tag === 'time' || tag === 'h1' || tag === 'h2' || tag === 'h3' ||
          child.getAttribute?.('role') === 'heading' ||
          TIME_RE.test(t) || USER_RE.test(t);

        if (isHighValue) {
          parts.unshift(t.slice(0, 35)); // high-value at front
        } else if (parts.length < 2) {
          parts.push(t.slice(0, 35));
        }
        if (parts.length >= 2) break;
      }

      if (parts.length > 0) return parts.join(' · ');
      parent = parent.parentElement;
    }
    return '';
  }

  /* ── Detect active modals/dialogs/popups that may block interaction ── */
  function detectActiveModal() {
    const MODAL_SELECTORS = '[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog[open]';

    function searchRoot(root, depth) {
      if (depth > 6) return null;
      try {
        const elements = root.querySelectorAll(MODAL_SELECTORS);
        for (const el of elements) {
          if (!isVisible(el)) continue;
          // Get modal title from heading or aria attributes
          let title = '';
          const heading = el.querySelector('h1, h2, h3, h4, [role="heading"]');
          if (heading) title = (heading.textContent || '').trim().slice(0, 80);
          if (!title) title = el.getAttribute('aria-label') || '';
          if (!title) {
            // Try aria-labelledby
            const labelId = el.getAttribute('aria-labelledby');
            if (labelId) {
              const labelEl = document.getElementById(labelId);
              if (labelEl) title = (labelEl.textContent || '').trim().slice(0, 80);
            }
          }
          if (!title) title = 'Unknown dialog';
          return { title, role: el.getAttribute('role') || el.tagName.toLowerCase() };
        }
      } catch {}

      // Walk shadow roots
      try {
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) {
            const found = searchRoot(el.shadowRoot, depth + 1);
            if (found) return found;
          }
        }
      } catch {}
      return null;
    }

    return searchRoot(document, 0);
  }

  /* ── Build compact text snapshot with section grouping ── */
  function buildSnapshot(includePageText) {
    const tagged = rebuildElementMap();
    const lines = [];
    lines.push(`PAGE: ${location.href}`);
    lines.push(`TITLE: ${document.title}`);
    lines.push(`VIEWPORT: ${window.innerWidth}x${window.innerHeight} scroll=${Math.round(window.scrollY)}`);

    // Detect active modals/popups that may be blocking the page
    const activeModal = detectActiveModal();
    if (activeModal) {
      lines.push(`\n⚠️ MODAL/POPUP ACTIVE: "${activeModal.title}" (${activeModal.role})`);
      lines.push(`   → You MUST handle this popup before continuing your task.`);
      lines.push(`   → Look for "Done", "OK", "Close", "X", "Cancel", "Back", or "Dismiss" buttons below.`);
      lines.push(`   → If this popup is blocking your task, dismiss it first, then re-scan.`);
    }

    if (includePageText) {
      const text = (document.body.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 1500);
      lines.push(`TEXT: ${text}`);
    }

    const totalFound = rebuildElementMap.lastTotalCount;
    const showing = tagged.length;
    const countNote = totalFound > showing ? ` (showing ${showing} of ${totalFound})` : '';
    lines.push(`\nELEMENTS${countNote}:`);

    const vh = window.innerHeight;
    for (const { id, el, label, depth } of tagged) {
      const role = getRole(el);
      const tag = el.tagName.toLowerCase();

      let desc = `  [${id}] ${role} "${label}"`;
      if (depth > 0) desc += ` [shadow]`;

      // ARIA states
      const ariaExpanded = el.getAttribute('aria-expanded');
      if (ariaExpanded !== null) desc += ` expanded=${ariaExpanded}`;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') desc += ` [disabled]`;

      // Form fields
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable) {
        const ph = el.getAttribute('placeholder');
        if (ph) desc += ` placeholder="${ph}"`;
      }

      // Links
      if (tag === 'a' && el.href) {
        try { desc += ` href=${new URL(el.href).pathname.slice(0, 40)}`; } catch {}
      }

      // Action menu warning
      const lbl = label.toLowerCase();
      if (lbl.includes('options list') || el.getAttribute('aria-haspopup') === 'true' || el.getAttribute('aria-haspopup') === 'menu') {
        desc += ' ⚠MENU';
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

      case 'getPageText':
        sendResponse({
          ok: true,
          text: (document.body?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 3000),
          url: location.href,
          title: document.title,
        });
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
        // Note: closest() doesn't cross shadow DOM boundaries, so we also check
        // the element's role, root node, and parent custom elements
        const role = el.getAttribute('role');
        const rootNode = el.getRootNode();
        const isInShadow = rootNode instanceof ShadowRoot;
        const parentHost = isInShadow ? rootNode.host : null;
        const parentHostTag = parentHost?.tagName?.toLowerCase() || '';

        const isInMenu = role === 'menuitem' || role === 'option' ||
          el.closest?.('[role="menu"]') ||
          el.closest?.('[role="dialog"]') ||
          el.closest?.('[role="listbox"]') ||
          el.closest?.('[aria-haspopup]') ||
          // Shadow DOM: check if parent host is a menu/dropdown/popup component
          parentHostTag.includes('menu') ||
          parentHostTag.includes('dropdown') ||
          parentHostTag.includes('popup') ||
          parentHostTag.includes('popover') ||
          parentHostTag.includes('popper') ||
          parentHostTag.includes('overflow') ||
          // Check if any ancestor custom element is a menu
          (isInShadow && parentHost?.closest?.('[role="menu"],[role="listbox"]'));

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
