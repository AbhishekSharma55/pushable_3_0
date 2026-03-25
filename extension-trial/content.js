/**
 * content.js — Browser automation v3.2
 *
 * Critical fix: ALL synthetic events use composed:true to cross shadow DOM boundaries.
 * Without composed:true, events dispatched on shadow children stop at the shadow boundary
 * and never reach the host's event listeners (e.g. Reddit upvote, Facebook like).
 *
 * Strategy:
 * - Recursive shadow DOM traversal with depth guard
 * - Element map with data-psh-id tags for reliable re-discovery
 * - Full pointer event sequence (pointerover→click) with composed:true
 * - Smart typing: detects contenteditable, shadow inputs, placeholder→editor swaps
 */
(() => {
  let elementMap = new Map(); // id → { el, label, depth }
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

  /* ══════════════════════════════════════════════════════════════
   *  HELPERS
   * ══════════════════════════════════════════════════════════════ */

  function isVisible(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return false;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    try {
      const style = getComputedStyle(el);
      if (style.display === 'none') return false;
      if (style.visibility === 'hidden') return false;
      if (style.opacity === '0') return false;
    } catch { return false; }
    return true;
  }

  function getLabel(el) {
    const candidates = [
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.getAttribute('placeholder'),
      el.getAttribute('data-testid'),
      el.getAttribute('data-click-id'),   // Reddit uses this
      el.getAttribute('alt'),
      el.getAttribute('name'),
    ];
    for (const c of candidates) {
      if (c && c.trim()) return c.trim().replace(/[\n\r\t]+/g, ' ').slice(0, 60);
    }
    const text = (el.innerText || '').trim();
    if (text && text.length <= 80) return text.replace(/\s+/g, ' ').slice(0, 60);
    if (el.value && typeof el.value === 'string') return el.value.slice(0, 60);
    return '';
  }

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

  /* ══════════════════════════════════════════════════════════════
   *  SHADOW DOM TRAVERSAL — recursive with depth guard
   * ══════════════════════════════════════════════════════════════ */

  function collectElements(root, results, depth) {
    if (depth > 8) return;

    // Query this root for interactive elements
    let nodes = [];
    try { nodes = [...root.querySelectorAll(SELECTORS)]; } catch {}

    for (const el of nodes) {
      if (!isVisible(el)) continue;
      const label = getLabel(el);
      results.push({ el, label, depth });

      // If this element hosts a shadow root, recurse into it
      if (el.shadowRoot) {
        collectElements(el.shadowRoot, results, depth + 1);
      }
    }

    // Also walk ALL elements under this root looking for shadow hosts
    // (catches hosts that aren't in our selector list, e.g. <shreddit-vote-button>)
    try {
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) {
          collectElements(el.shadowRoot, results, depth + 1);
        }
      }
    } catch {}
  }

  function querySelectorDeep(selector) {
    // Fast path
    try {
      const el = document.querySelector(selector);
      if (el) return el;
    } catch {}

    // Check by data-psh-id
    if (selector.startsWith('[data-psh-id=')) {
      const visited = new WeakSet();
      function search(root) {
        if (!root || visited.has(root)) return null;
        visited.add(root);
        try {
          const el = root.querySelector(selector);
          if (el) return el;
        } catch {}
        try {
          for (const child of root.querySelectorAll('*')) {
            if (child.shadowRoot) {
              const found = search(child.shadowRoot);
              if (found) return found;
            }
          }
        } catch {}
        return null;
      }
      return search(document);
    }

    return null;
  }

  /* ══════════════════════════════════════════════════════════════
   *  ELEMENT MAP — scan, tag, resolve
   * ══════════════════════════════════════════════════════════════ */

  function rebuildElementMap() {
    // Clear old tags
    try {
      document.querySelectorAll('[data-psh-id]').forEach(el => {
        try { el.removeAttribute('data-psh-id'); } catch {}
      });
    } catch {}

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

    // Sort by viewport position, take top 80
    unique.sort((a, b) => {
      const ra = a.el.getBoundingClientRect();
      const rb = b.el.getBoundingClientRect();
      return ra.top - rb.top;
    });

    const tagged = [];
    for (const item of unique.slice(0, 80)) {
      const id = nextId++;
      elementMap.set(id, item);
      try { item.el.setAttribute('data-psh-id', String(id)); } catch {}
      tagged.push({ id, ...item });
    }
    return tagged;
  }

  function resolveElement(ref) {
    if (ref === undefined || ref === null) return null;

    // Numeric → map lookup
    if (typeof ref === 'number') {
      const entry = elementMap.get(ref);
      return entry ? entry.el : null;
    }

    if (typeof ref === 'string') {
      const trimmed = ref.trim();

      // Numeric string → map lookup
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && String(num) === trimmed && elementMap.has(num)) {
        return elementMap.get(num).el;
      }

      // data-psh-id selector → deep search
      if (trimmed.startsWith('[data-psh-id=')) {
        return querySelectorDeep(trimmed);
      }

      // CSS selector
      try {
        const el = document.querySelector(trimmed);
        if (el) return el;
      } catch {}

      // Deep CSS selector (shadow DOM)
      return querySelectorDeep(trimmed);
    }
    return null;
  }

  /* ══════════════════════════════════════════════════════════════
   *  PAGE INFO / GET ELEMENTS — returns tagged elements
   * ══════════════════════════════════════════════════════════════ */

  function domGetPageInfo() {
    const tagged = rebuildElementMap();
    const url = location.href;
    const title = document.title;
    const text = (document.body.innerText || '').slice(0, 3000);

    const inputs = [], buttons = [], links = [];

    for (const { id, el, label, depth } of tagged) {
      const selector = `[data-psh-id="${id}"]`;
      const tag = el.tagName.toLowerCase();
      const shadowInfo = depth > 0 ? ` [shadow:${depth}]` : '';

      if (tag === 'input' || tag === 'textarea' || tag === 'select' ||
          el.isContentEditable || el.getAttribute('role') === 'textbox' ||
          el.getAttribute('role') === 'combobox' || el.getAttribute('role') === 'searchbox') {
        if (inputs.length < 30) {
          inputs.push({
            selector, tag, label: label + shadowInfo,
            type: el.type || (el.isContentEditable ? 'contenteditable' : ''),
            placeholder: el.getAttribute('placeholder') || '',
            value: el.isContentEditable ? (el.innerText || '').slice(0, 100) : (el.value || '').slice(0, 100),
            name: el.getAttribute('name') || '',
            ariaLabel: el.getAttribute('aria-label') || ''
          });
        }
      } else if (tag === 'a' && el.href) {
        if (links.length < 50) {
          links.push({ href: el.href, text: (label + shadowInfo).slice(0, 80), selector });
        }
      } else {
        if (buttons.length < 40) {
          buttons.push({
            selector, tag, text: (label + shadowInfo).slice(0, 80),
            role: el.getAttribute('role') || '',
            ariaLabel: el.getAttribute('aria-label') || ''
          });
        }
      }
    }

    return { url, title, text, inputs, buttons, links };
  }

  function domGetElements() {
    const tagged = rebuildElementMap();
    const inputs = [], clickables = [];

    for (const { id, el, label, depth } of tagged) {
      const selector = `[data-psh-id="${id}"]`;
      const tag = el.tagName.toLowerCase();
      const shadowInfo = depth > 0 ? ` [shadow:${depth}]` : '';

      if (tag === 'input' || tag === 'textarea' || tag === 'select' ||
          el.isContentEditable || el.getAttribute('role') === 'textbox' ||
          el.getAttribute('role') === 'combobox') {
        if (inputs.length < 30) {
          inputs.push({
            tag, selector, label: label + shadowInfo, visible: true,
            type: el.type || (el.isContentEditable ? 'contenteditable' : ''),
            placeholder: el.getAttribute('placeholder') || '',
            value: el.isContentEditable ? (el.innerText || '').slice(0, 100) : (el.value || '').slice(0, 100),
          });
        }
      } else {
        if (clickables.length < 40) {
          clickables.push({
            tag, selector, visible: true,
            text: (label + shadowInfo).slice(0, 80),
            href: el.href || '',
            role: el.getAttribute('role') || '',
            ariaLabel: el.getAttribute('aria-label') || ''
          });
        }
      }
    }

    return { inputs, clickables };
  }

  /* ══════════════════════════════════════════════════════════════
   *  CLICK — composed:true event sequence that crosses shadow DOM
   * ══════════════════════════════════════════════════════════════ */

  function shadowSafeClick(el) {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const baseOpts = {
      bubbles: true,
      cancelable: true,
      composed: true,     // ← CRITICAL: crosses shadow DOM boundaries
      clientX: cx,
      clientY: cy,
      screenX: cx + window.screenX,
      screenY: cy + window.screenY,
      button: 0,
      buttons: 1,
      view: window,
    };

    // Full pointer+mouse event sequence — many shadow components listen for
    // pointerdown+pointerup rather than just click
    el.dispatchEvent(new PointerEvent('pointerover',  { ...baseOpts }));
    el.dispatchEvent(new PointerEvent('pointerenter', { ...baseOpts, bubbles: false }));
    el.dispatchEvent(new MouseEvent('mouseover',      baseOpts));
    el.dispatchEvent(new MouseEvent('mouseenter',     { ...baseOpts, bubbles: false }));
    el.dispatchEvent(new MouseEvent('mousemove',      baseOpts));
    el.dispatchEvent(new PointerEvent('pointerdown',  baseOpts));
    el.dispatchEvent(new MouseEvent('mousedown',      baseOpts));
    if (typeof el.focus === 'function') el.focus();
    el.dispatchEvent(new PointerEvent('pointerup',    baseOpts));
    el.dispatchEvent(new MouseEvent('mouseup',        baseOpts));
    el.dispatchEvent(new MouseEvent('click',          baseOpts));
    el.dispatchEvent(new PointerEvent('pointerout',   baseOpts));
    el.dispatchEvent(new MouseEvent('mouseout',       baseOpts));
  }

  function domClick(ref) {
    const el = resolveElement(ref);
    if (!el) return { ok: false, error: `Element not found: ${ref}` };

    el.scrollIntoView({ block: 'center', behavior: 'instant' });

    // Use native .click() first — triggers built-in behaviors
    try { el.click(); } catch {}

    // Then fire full composed event sequence for shadow DOM components
    shadowSafeClick(el);

    return { ok: true };
  }

  function domClickPoint(nx, ny) {
    const px = Math.round(nx * window.innerWidth);
    const py = Math.round(ny * window.innerHeight);
    const el = document.elementFromPoint(px, py);
    if (!el) return { ok: false, error: `No element at (${px}, ${py})` };

    try { el.click(); } catch {}
    shadowSafeClick(el);

    return { ok: true, x: px, y: py, tag: el.tagName.toLowerCase() };
  }

  /* ══════════════════════════════════════════════════════════════
   *  TYPE — shadow-aware, finds real editor after placeholder swap
   * ══════════════════════════════════════════════════════════════ */

  function findBestTypingTarget(originalEl) {
    // 1. Currently focused element
    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement) {
      if (active.isContentEditable || active.tagName === 'TEXTAREA' || active.tagName === 'INPUT') {
        return active;
      }
      // Check shadow root of focused element
      if (active.shadowRoot) {
        const inner = active.shadowRoot.querySelector('[contenteditable="true"], textarea, input:not([type=hidden])');
        if (inner && isVisible(inner)) return inner;
      }
    }

    // 2. Original element if still editable
    if (originalEl && document.body.contains(originalEl)) {
      if (originalEl.isContentEditable || originalEl.tagName === 'TEXTAREA' || originalEl.tagName === 'INPUT') {
        return originalEl;
      }
      // Check shadow root of original element
      if (originalEl.shadowRoot) {
        const inner = originalEl.shadowRoot.querySelector('[contenteditable="true"], textarea, input:not([type=hidden])');
        if (inner) return inner;
      }
    }

    // 3. Search all shadow roots for contenteditable
    const editables = [];
    collectElements(document, editables, 0);
    for (const { el } of editables) {
      if (el.isContentEditable && isVisible(el)) return el;
      if ((el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && isVisible(el)) return el;
    }

    return originalEl;
  }

  function shadowSafeType(el, text) {
    el.focus();
    // If the element has a shadow root with an inner input, type into that
    const realInput = el.shadowRoot?.querySelector('input, textarea') || el;

    if (realInput.isContentEditable) {
      // Contenteditable: use execCommand
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(realInput);
      sel.removeAllRanges();
      sel.addRange(range);
      if (realInput.textContent) document.execCommand('delete', false, null);
      const ok = document.execCommand('insertText', false, text);
      if (!ok) {
        realInput.textContent = '';
        realInput.appendChild(document.createTextNode(text));
      }
      realInput.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
      realInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    } else {
      // Standard input/textarea
      const tracker = realInput._valueTracker;
      if (tracker) tracker.setValue('');

      const proto = Object.getPrototypeOf(realInput);
      const desc =
        Object.getOwnPropertyDescriptor(proto, 'value') ||
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');

      if (desc && desc.set) desc.set.call(realInput, text);
      else realInput.value = text;

      realInput.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
      realInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }
  }

  function domType(ref, text) {
    let el = resolveElement(ref);
    if (!el) return { ok: false, error: `Element not found: ${ref}` };

    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    if (typeof el.focus === 'function') el.focus();

    // If not editable, click first (might open editor) then find real target
    const isEditable = el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
    if (!isEditable) {
      try { el.click(); } catch {}
      shadowSafeClick(el);
      const target = findBestTypingTarget(el);
      if (target && target !== el) {
        el = target;
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        if (typeof el.focus === 'function') el.focus();
      }
    }

    shadowSafeType(el, text);
    return { ok: true };
  }

  function domTypeChar(ref, text, delay = 80) {
    return new Promise((resolve) => {
      let el = resolveElement(ref);
      if (!el) { resolve({ ok: false, error: `Element not found: ${ref}` }); return; }

      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      if (typeof el.focus === 'function') el.focus();

      // Smart target detection
      const isEditable = el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
      if (!isEditable) {
        try { el.click(); } catch {}
        const target = findBestTypingTarget(el);
        if (target) el = target;
        if (typeof el.focus === 'function') el.focus();
      }

      const realInput = el.shadowRoot?.querySelector('input, textarea') || el;
      const isContentEditable = realInput.isContentEditable;
      let i = 0;

      function typeNext() {
        if (i >= text.length) {
          realInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          resolve({ ok: true });
          return;
        }
        const ch = text[i];
        const keyOpts = { key: ch, code: `Key${ch.toUpperCase()}`, bubbles: true, cancelable: true, composed: true };

        realInput.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
        realInput.dispatchEvent(new KeyboardEvent('keypress', keyOpts));

        if (isContentEditable) {
          document.execCommand('insertText', false, ch);
        } else {
          const tracker = realInput._valueTracker;
          if (tracker) tracker.setValue(realInput.value);
          const proto = Object.getPrototypeOf(realInput);
          const desc =
            Object.getOwnPropertyDescriptor(proto, 'value') ||
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
          if (desc && desc.set) desc.set.call(realInput, realInput.value + ch);
          else realInput.value += ch;
        }

        realInput.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: ch }));
        realInput.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
        i++;
        setTimeout(typeNext, delay);
      }
      typeNext();
    });
  }

  /* ══════════════════════════════════════════════════════════════
   *  OTHER INTERACTIONS
   * ══════════════════════════════════════════════════════════════ */

  function domKeyPress(key) {
    const keyMap = {
      Enter:      { key: 'Enter',      code: 'Enter',      keyCode: 13 },
      Tab:        { key: 'Tab',        code: 'Tab',        keyCode: 9 },
      Escape:     { key: 'Escape',     code: 'Escape',     keyCode: 27 },
      Backspace:  { key: 'Backspace',  code: 'Backspace',  keyCode: 8 },
      Delete:     { key: 'Delete',     code: 'Delete',     keyCode: 46 },
      Space:      { key: ' ',          code: 'Space',      keyCode: 32 },
      ArrowUp:    { key: 'ArrowUp',    code: 'ArrowUp',    keyCode: 38 },
      ArrowDown:  { key: 'ArrowDown',  code: 'ArrowDown',  keyCode: 40 },
      ArrowLeft:  { key: 'ArrowLeft',  code: 'ArrowLeft',  keyCode: 37 },
      ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    };
    const mapped = keyMap[key] || { key, code: key, keyCode: 0 };
    const target = document.activeElement || document.body;
    const opts = { ...mapped, bubbles: true, cancelable: true, composed: true };
    target.dispatchEvent(new KeyboardEvent('keydown', opts));
    target.dispatchEvent(new KeyboardEvent('keypress', opts));
    target.dispatchEvent(new KeyboardEvent('keyup', opts));
    if (key === 'Enter' && target.form) {
      try { target.form.requestSubmit ? target.form.requestSubmit() : target.form.submit(); } catch {}
    }
    return { ok: true };
  }

  function domSelect(ref, value) {
    const el = resolveElement(ref);
    if (!el) return { ok: false, error: `Element not found: ${ref}` };
    const tracker = el._valueTracker;
    if (tracker) tracker.setValue('');
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return { ok: true };
  }

  function domHover(ref) {
    const el = resolveElement(ref);
    if (!el) return { ok: false, error: `Element not found: ${ref}` };
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy, view: window };
    el.dispatchEvent(new PointerEvent('pointerover', opts));
    el.dispatchEvent(new MouseEvent('mouseover', opts));
    el.dispatchEvent(new PointerEvent('pointerenter', { ...opts, bubbles: false }));
    el.dispatchEvent(new MouseEvent('mouseenter', { ...opts, bubbles: false }));
    el.dispatchEvent(new MouseEvent('mousemove', opts));
    return { ok: true };
  }

  function domScroll(selector, x, y) {
    if (selector) {
      const el = resolveElement(selector);
      if (!el) return { ok: false, error: `Element not found: ${selector}` };
      el.scrollBy({ left: x || 0, top: y || 0, behavior: 'instant' });
    } else {
      window.scrollBy({ left: x || 0, top: y || 0, behavior: 'instant' });
    }
    return { ok: true };
  }

  function domWaitForElement(selector, timeout = 10000) {
    return new Promise((resolve) => {
      const start = Date.now();
      function poll() {
        const el = resolveElement(selector) || querySelectorDeep(selector);
        if (el && isVisible(el)) { resolve({ ok: true }); return; }
        if (Date.now() - start >= timeout) { resolve({ ok: false, error: `Timeout waiting for: ${selector}` }); return; }
        setTimeout(poll, 300);
      }
      poll();
    });
  }

  function domGetAttribute(ref, attribute) {
    const el = resolveElement(ref);
    if (!el) return { ok: false, error: `Element not found: ${ref}` };
    return { ok: true, value: el.getAttribute(attribute) ?? el[attribute] ?? null };
  }

  function domGetCoords(ref) {
    const el = resolveElement(ref);
    if (!el) return { error: 'not found' };
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  /* ══════════════════════════════════════════════════════════════
   *  WAIT FOR DOM
   * ══════════════════════════════════════════════════════════════ */

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

  /* ══════════════════════════════════════════════════════════════
   *  MESSAGE HANDLER
   * ══════════════════════════════════════════════════════════════ */

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const action = msg.action || msg.type;

    switch (action) {
      case 'ping':
        sendResponse({ ok: true, url: location.href });
        return false;

      case 'getPageInfo':
        sendResponse(domGetPageInfo());
        return false;

      case 'getElements':
      case 'getInteractiveElements':
        sendResponse(domGetElements());
        return false;

      case 'getCoords':
        sendResponse(domGetCoords(msg.selector || msg.elementId));
        return false;

      case 'click':
        sendResponse(domClick(msg.selector || msg.elementId));
        return false;

      case 'clickPoint':
        sendResponse(domClickPoint(msg.x, msg.y));
        return false;

      case 'type':
        sendResponse(domType(msg.selector || msg.elementId, msg.text));
        return false;

      case 'typeChar':
        domTypeChar(msg.selector || msg.elementId, msg.text, msg.delay || 80).then(sendResponse);
        return true;

      case 'keyPress':
        sendResponse(domKeyPress(msg.key));
        return false;

      case 'select':
        sendResponse(domSelect(msg.selector || msg.elementId, msg.value));
        return false;

      case 'hover':
        sendResponse(domHover(msg.selector || msg.elementId));
        return false;

      case 'scroll':
        sendResponse(domScroll(msg.selector, msg.x, msg.y));
        return false;

      case 'waitForElement':
        domWaitForElement(msg.selector, msg.timeout || 10000).then(sendResponse);
        return true;

      case 'getAttribute':
        sendResponse(domGetAttribute(msg.selector || msg.elementId, msg.attribute));
        return false;

      case 'waitForDOM':
        waitForDOM(msg.quietMs || 400, msg.maxMs || 5000).then(sendResponse);
        return true;

      default:
        sendResponse({ ok: false, error: `Unknown action: ${action}` });
        return false;
    }
  });
})();
