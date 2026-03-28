/**
 * content.js — Browser Agent v4 (CDP edition)
 *
 * Slimmed content script. Element discovery/scanning is now handled entirely
 * by the CDP Accessibility tree in background.js. This script is responsible
 * only for lightweight operations that benefit from persistent DOM observation:
 *   - scroll (window / element)
 *   - waitForDOM (MutationObserver settle)
 *   - waitForElement (polling + MutationObserver)
 *   - getAttribute (direct DOM read)
 *   - getPageText (body innerText for LLM context)
 *   - ping (health check)
 */
(() => {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.action) {

      /* ── Health check ── */
      case 'ping':
        sendResponse({ ok: true });
        return false;

      /* ── Page text for LLM snapshot ── */
      case 'getPageText':
        sendResponse({
          ok: true,
          text: (document.body?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 3000),
          url: location.href,
          title: document.title,
        });
        return false;

      /* ── Scroll ── */
      case 'scroll': {
        const { selector, x = 0, y = 0 } = msg;
        let el = null;
        if (selector) {
          try { el = document.querySelector(selector); } catch {}
        }
        if (el) {
          el.scrollBy({ left: x, top: y, behavior: 'smooth' });
        } else {
          window.scrollBy({ left: x, top: y, behavior: 'smooth' });
        }
        sendResponse({ ok: true });
        return false;
      }

      /* ── Wait for DOM mutations to settle ── */
      case 'waitForDOM': {
        const quietMs = msg.quietMs || 400;
        const maxMs   = msg.maxMs   || 5000;
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

        const maxTimer = setTimeout(finish, maxMs);

        function resetQuiet() {
          if (timer) clearTimeout(timer);
          timer = setTimeout(finish, quietMs);
        }

        observer = new MutationObserver(resetQuiet);
        observer.observe(document.documentElement, {
          childList: true, subtree: true, attributes: true, characterData: true,
        });
        resetQuiet(); // start quiet timer even if no mutations
        // Replace maxTimer with one that also fires finish
        setTimeout(() => { if (!done) { clearTimeout(maxTimer); finish(); } }, maxMs);
        return true; // async response
      }

      /* ── Wait for an element matching a CSS selector to appear ── */
      case 'waitForElement': {
        const { selector, timeout = 10000 } = msg;
        if (!selector) { sendResponse({ ok: false, error: 'No selector' }); return false; }

        // Check immediately
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

      /* ── Read an attribute of a DOM element ── */
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
