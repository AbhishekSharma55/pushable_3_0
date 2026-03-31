/**
 * content.js — v6 (Python CDP Analyzer Edition)
 * Minimal — only handles scroll, keyPress, ping, and fallback element scan.
 * All heavy lifting done by Python analyzer.
 */
(() => {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.action) {
      case 'ping':
        sendResponse({ ok: true });
        return false;

      case 'scroll': {
        const { x = 0, y = 0 } = msg;
        // Smart scroll: if a modal/dialog/overlay is open, scroll THAT instead of the window
        // Facebook, Reddit, etc. render posts in modal overlays that have their own scroll
        const modalSelectors = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], .modal, [class*="overlay"], [class*="dialog"], [class*="modal"]';
        let scrollTarget = null;
        // Check for modals, including inside shadow DOM
        function findScrollable(root, depth) {
          if (depth > 8 || scrollTarget) return;
          try {
            for (const el of root.querySelectorAll(modalSelectors)) {
              const style = getComputedStyle(el);
              if (style.overflow === 'auto' || style.overflow === 'scroll' ||
                  style.overflowY === 'auto' || style.overflowY === 'scroll') {
                if (el.scrollHeight > el.clientHeight) { scrollTarget = el; return; }
              }
            }
            // Also check any element with scrollable overflow
            for (const el of root.querySelectorAll('*')) {
              if (scrollTarget) return;
              const style = getComputedStyle(el);
              if ((style.overflow === 'auto' || style.overflow === 'scroll' ||
                   style.overflowY === 'auto' || style.overflowY === 'scroll') &&
                  el.scrollHeight > el.clientHeight + 100 && el !== document.documentElement && el !== document.body) {
                // This is a scrollable container (not the main page)
                const r = el.getBoundingClientRect();
                if (r.width > 200 && r.height > 200) { scrollTarget = el; return; }
              }
              if (el.shadowRoot) findScrollable(el.shadowRoot, depth + 1);
            }
          } catch {}
        }
        findScrollable(document, 0);

        if (scrollTarget) {
          scrollTarget.scrollBy({ left: x, top: y, behavior: 'smooth' });
        } else {
          window.scrollBy({ left: x, top: y, behavior: 'smooth' });
        }
        sendResponse({ ok: true, scrolledModal: !!scrollTarget });
        return false;
      }

      case 'keyPress': {
        const el = document.activeElement || document.body;
        el.dispatchEvent(new KeyboardEvent('keydown', { key: msg.key, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: msg.key, bubbles: true }));
        sendResponse({ ok: true });
        return false;
      }

      case 'getElements': {
        // Basic fallback scan when Python analyzer is unavailable
        const lines = [`PAGE: ${location.href}`, `TITLE: ${document.title}`, '', 'ELEMENTS:'];
        let id = 1;
        const seen = new Set();
        for (const el of document.querySelectorAll('button,a[href],input,textarea,select,[role="button"],[role="textbox"],[contenteditable]')) {
          const rect = el.getBoundingClientRect();
          if (!rect.width || !rect.height) continue;
          const label = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || (el.innerText || '').trim().slice(0, 60);
          if (!label || seen.has(label)) continue;
          seen.add(label);
          const role = el.getAttribute('role') || el.tagName.toLowerCase();
          lines.push(`  [${id}] ${role} "${label}"`);
          id++;
          if (id > 80) break;
        }
        sendResponse({ snapshot: lines.join('\n') });
        return false;
      }

      default:
        return false;
    }
  });
})();
