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
        window.scrollBy({ left: x, top: y, behavior: 'smooth' });
        sendResponse({ ok: true });
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
