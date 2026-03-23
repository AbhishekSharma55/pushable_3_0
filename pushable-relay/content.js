/**
 * Browser Agent — Content Script
 * 
 * Injected into every page at document_idle.  The background service worker
 * primarily uses chrome.scripting.executeScript to inject functions directly;
 * this script provides a message-based fallback and a simple health-check ping.
 */
(function () {
  'use strict';

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'ping') {
      sendResponse({ ok: true, url: location.href });
      return;
    }

    if (msg.action === 'getInteractiveElements') {
      const body = document.body;
      if (!body) { sendResponse({ inputs: [], buttons: [] }); return; }

      const inputs = Array.from(body.querySelectorAll('input, textarea, select')).slice(0, 30).map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.type || 'text',
        id: el.id || null,
        name: el.name || null,
        placeholder: el.placeholder || null,
        value: (el.value || '').substring(0, 200),
      }));

      const buttons = Array.from(body.querySelectorAll('button, [role="button"], a[href]')).slice(0, 30).map((el) => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        text: (el.textContent || '').trim().substring(0, 100),
        href: el.href || null,
      }));

      sendResponse({ inputs, buttons });
    }
  });
})();
