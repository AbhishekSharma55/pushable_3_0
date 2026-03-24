/**
 * Browser Agent — Popup Controller
 *
 * Saves config to chrome.storage.local, sends connect/disconnect to the
 * background service worker, and polls for live status updates showing
 * connection state, tab count, and current streaming URL.
 */

const $ = (id) => document.getElementById(id);

const serverUrlEl  = $('serverUrl');
const apiKeyEl     = $('apiKey');
const connectBtn   = $('connectBtn');
const disconnectBtn = $('disconnectBtn');
const statusDot    = $('statusDot');
const statusText   = $('statusText');
const statusSubtext = $('statusSubtext');
const statusCard   = $('statusCard');
const tabUrlEl     = $('tabUrl');
const closePopupBtn = $('closePopupBtn');

let pollTimer = null;

if (closePopupBtn) {
  closePopupBtn.addEventListener('click', () => window.close());
}

// ── Load saved config ────────────────────────────────────────────────────────

chrome.storage.local.get(['serverUrl', 'apiKey'], (r) => {
  if (r.serverUrl) serverUrlEl.value = r.serverUrl;
  if (r.apiKey)    apiKeyEl.value    = r.apiKey;
});

// ── Connect ──────────────────────────────────────────────────────────────────

connectBtn.addEventListener('click', async () => {
  const serverUrl = serverUrlEl.value.trim();
  const apiKey    = apiKeyEl.value.trim();

  if (!serverUrl) {
    setStatus('error', 'Server URL required', 'Enter the WebSocket server URL to connect');
    return;
  }

  if (!apiKey) {
    setStatus('error', 'API Key required', 'Enter your workspace API key from Extension Settings');
    return;
  }

  await chrome.storage.local.set({ serverUrl, apiKey });
  chrome.runtime.sendMessage({ action: 'connect' });
  setStatus('connecting');
  connectBtn.disabled = true;
  startPolling();
});

// ── Disconnect ───────────────────────────────────────────────────────────────

disconnectBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'disconnect' });
  setStatus('disconnected');
  connectBtn.disabled = false;
  stopPolling();
  tabUrlEl.textContent = '';
});

// ── Status Display ───────────────────────────────────────────────────────────

function setStatus(status, mainText, subtext) {
  statusDot.className = 'status-indicator ' + status;
  statusCard.classList.toggle('connected', status === 'connected');
  statusCard.style.borderColor = status === 'error' ? 'rgba(239, 68, 68, 0.3)' : '';

  const defaults = {
    disconnected: { label: 'Disconnected',   sub: 'Enter URL and connect to start' },
    connecting:   { label: 'Connecting...',   sub: 'Establishing WebSocket connection...' },
    connected:    { label: 'Connected',       sub: 'Live screenshots streaming every 500ms' },
    error:        { label: 'Connection Failed', sub: 'Could not connect to server' },
  };

  const d = defaults[status] || defaults.disconnected;
  statusText.textContent    = mainText || d.label;
  statusSubtext.textContent = subtext  ?? d.sub;
}

// ── Polling ──────────────────────────────────────────────────────────────────

function startPolling() {
  stopPolling();
  poll(); // immediate first check
  pollTimer = setInterval(poll, 1000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function poll() {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getStatus' });
    if (!res) return;

    if (res.status === 'connected') {
      const n = res.tabCount ?? 0;
      setStatus('connected', `Connected — ${n} tab${n !== 1 ? 's' : ''}`, 'Live preview streaming every 500ms');
      connectBtn.disabled = true;
      updateStreamingUrl();
    } else if (res.status === 'connecting') {
      setStatus('connecting');
      connectBtn.disabled = true;
    } else if (res.status === 'error') {
      setStatus('error', 'Connection Failed', res.error || 'Check URL and API key');
      connectBtn.disabled = false;
      tabUrlEl.textContent = '';
      stopPolling();
    } else {
      setStatus('disconnected');
      connectBtn.disabled = false;
      tabUrlEl.textContent = '';
    }
  } catch (_) {
    // Extension context invalidated — ignore
  }
}

async function updateStreamingUrl() {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getStreamingTab' });
    tabUrlEl.textContent = res?.url || '';
  } catch (_) {
    tabUrlEl.textContent = '';
  }
}

// ── Initial Status ───────────────────────────────────────────────────────────

chrome.runtime.sendMessage({ action: 'getStatus' }, (res) => {
  if (!res) return;
  if (res.status === 'connected') {
    const n = res.tabCount ?? 0;
    setStatus('connected', `Connected — ${n} tab${n !== 1 ? 's' : ''}`, 'Live preview streaming every 500ms');
    connectBtn.disabled = true;
    startPolling();
    updateStreamingUrl();
  } else if (res.status === 'connecting') {
    setStatus('connecting');
    connectBtn.disabled = true;
    startPolling();
  } else if (res.status === 'error') {
    setStatus('error', 'Connection Failed', res.error || 'Check URL and API key');
    connectBtn.disabled = false;
  } else {
    setStatus('disconnected');
    connectBtn.disabled = false;
  }
});
