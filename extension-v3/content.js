/**
 * content.js — Browser Agent v5 (Human-Like CDP)
 *
 * Lightweight content script. Element discovery is handled by CDP AX tree
 * in background.js. This script handles:
 *   - ping (health check)
 *   - getPageText (body text for LLM context)
 *   - getElements (fallback DOM scan when CDP unavailable)
 *   - detectModal (active dialog/popup detection)
 *   - scroll (window / element)
 *   - waitForDOM (MutationObserver settle)
 *   - waitForElement (polling + observer)
 *   - getAttribute (direct DOM read)
 */
(() => {
  /* ── Visibility check ── */
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

  /* ── Modal/dialog detection ── */
  function detectActiveModal() {
    const MODAL_SELECTORS = '[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog[open]';

    function searchRoot(root, depth) {
      if (depth > 6) return null;
      try {
        const elements = root.querySelectorAll(MODAL_SELECTORS);
        for (const el of elements) {
          if (!isVisible(el)) continue;
          let title = '';
          const heading = el.querySelector('h1, h2, h3, h4, [role="heading"]');
          if (heading) title = (heading.textContent || '').trim().slice(0, 80);
          if (!title) title = el.getAttribute('aria-label') || '';
          if (!title) {
            const labelId = el.getAttribute('aria-labelledby');
            if (labelId) {
              const labelEl = document.getElementById(labelId);
              if (labelEl) title = (labelEl.textContent || '').trim().slice(0, 80);
            }
          }
          if (!title) title = 'Unknown dialog';
          return { active: true, title, role: el.getAttribute('role') || el.tagName.toLowerCase() };
        }
      } catch {}

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

    return searchRoot(document, 0) || { active: false };
  }

  /* ── Fallback DOM element scan (when CDP unavailable) ── */
  function scanElements() {
    const SELECTORS = [
      'button:not([disabled])', 'a[href]', 'input:not([type=hidden])', 'select', 'textarea',
      '[role="button"]', '[role="tab"]', '[role="menuitem"]', '[role="option"]', '[role="textbox"]',
      '[role="combobox"]', '[role="searchbox"]', '[role="switch"]', '[role="checkbox"]', '[role="radio"]',
      '[contenteditable="true"]', '[contenteditable=""]',
      '[tabindex]:not([tabindex="-1"])',
      '.msg-form__contenteditable', '.ql-editor', '.ProseMirror', '.DraftEditor-root',
      '[data-placeholder]',
      'details > summary',
    ].join(', ');

    function collectFromRoot(root, results, depth) {
      if (depth > 8) return;
      try {
        const nodes = root.querySelectorAll(SELECTORS);
        for (const el of nodes) {
          if (!isVisible(el)) continue;
          const label = el.getAttribute('aria-label') || el.getAttribute('title') ||
                        el.getAttribute('placeholder') || el.getAttribute('data-placeholder') ||
                        (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80) || '';
          if (!label) continue;

          let role = el.getAttribute('role') || el.tagName.toLowerCase();
          if (el.isContentEditable) role = 'editor';
          if (el.tagName === 'BUTTON') role = 'button';
          if (el.tagName === 'A') role = 'link';
          if (el.tagName === 'INPUT') role = el.type || 'input';
          if (el.tagName === 'TEXTAREA') role = 'textarea';

          results.push({ label, role, depth });
        }
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) collectFromRoot(el.shadowRoot, results, depth + 1);
        }
      } catch {}
    }

    const results = [];
    collectFromRoot(document, results, 0);

    // Deduplicate and limit
    const seen = new Set();
    const unique = results.filter(r => {
      const key = r.role + ':' + r.label;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 120);

    const lines = [`PAGE: ${location.href}`, `TITLE: ${document.title}`, '', 'ELEMENTS:'];
    unique.forEach((r, i) => {
      let line = `  [${i + 1}] ${r.role} "${r.label}"`;
      if (r.depth > 0) line += ' [shadow]';
      lines.push(line);
    });

    return { snapshot: lines.join('\n') };
  }

  /* ── Message handler ── */
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.action) {

      case 'ping':
        sendResponse({ ok: true });
        return false;

      case 'getPageText':
        sendResponse({
          ok: true,
          text: (document.body?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 3000),
          url: location.href,
          title: document.title,
        });
        return false;

      case 'detectModal':
        sendResponse(detectActiveModal());
        return false;

      case 'getElements':
        sendResponse(scanElements());
        return false;

      case 'scroll': {
        const { selector, x = 0, y = 0 } = msg;
        let el = null;
        if (selector) { try { el = document.querySelector(selector); } catch {} }
        if (el) {
          el.scrollBy({ left: x, top: y, behavior: 'smooth' });
        } else {
          window.scrollBy({ left: x, top: y, behavior: 'smooth' });
        }
        sendResponse({ ok: true });
        return false;
      }

      case 'waitForDOM': {
        const quietMs = msg.quietMs || 400;
        const maxMs = msg.maxMs || 5000;
        let timer = null;
        let observer = null;
        let done = false;

        function finish() {
          if (done) return;
          done = true;
          if (observer) observer.disconnect();
          if (timer) clearTimeout(timer);
          sendResponse({ ok: true });
        }

        setTimeout(finish, maxMs);

        function resetQuiet() {
          if (timer) clearTimeout(timer);
          timer = setTimeout(finish, quietMs);
        }

        observer = new MutationObserver(resetQuiet);
        observer.observe(document.documentElement, {
          childList: true, subtree: true, attributes: true, characterData: true,
        });
        resetQuiet();
        return true; // async response
      }

      case 'waitForElement': {
        const { selector, timeout = 10000 } = msg;
        if (!selector) { sendResponse({ ok: false, error: 'No selector' }); return false; }

        let el = null;
        try { el = document.querySelector(selector); } catch {}
        if (el) { sendResponse({ ok: true }); return false; }

        let done = false;
        const deadline = setTimeout(() => {
          if (!done) { done = true; if (obs) obs.disconnect(); sendResponse({ ok: false, error: 'Timeout' }); }
        }, timeout);

        const obs = new MutationObserver(() => {
          if (done) return;
          let found = null;
          try { found = document.querySelector(selector); } catch {}
          if (found) {
            done = true;
            clearTimeout(deadline);
            obs.disconnect();
            sendResponse({ ok: true });
          }
        });
        obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
        return true; // async response
      }

      case 'getAttribute': {
        const { selector, attribute } = msg;
        if (!selector || !attribute) { sendResponse({ ok: false, error: 'Missing selector or attribute' }); return false; }
        let el = null;
        try { el = document.querySelector(selector); } catch {}
        if (!el) { sendResponse({ ok: false, error: 'Element not found: ' + selector }); return false; }
        sendResponse({ ok: true, value: el.getAttribute(attribute) });
        return false;
      }

      default:
        return false;
    }
  });
})();
