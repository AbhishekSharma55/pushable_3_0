(() => {
  const serverUrlInput = document.getElementById('serverUrl');
  const apiKeyInput    = document.getElementById('apiKey');
  const connectBtn     = document.getElementById('connectBtn');
  const disconnectBtn  = document.getElementById('disconnectBtn');
  const statusDot      = document.getElementById('statusDot');
  const statusText     = document.getElementById('statusText');
  const statusCard     = document.getElementById('statusCard');
  const tabInfo        = document.getElementById('tabInfo');
  const cdpWarn        = document.getElementById('cdpWarn');
  const errorMsg       = document.getElementById('errorMsg');

  // Load saved API key
  chrome.storage.local.get(['apiKey'], (data) => {
    if (data.apiKey) apiKeyInput.value = data.apiKey;
  });

  function updateUI(status) {
    const state = status.status || 'disconnected';
    statusDot.className  = 'dot ' + state;
    statusCard.className = 'status ' + state;

    const labels = {
      disconnected: 'Disconnected',
      connecting:   'Connecting\u2026',
      connected:    'Connected',
      error:        'Error',
    };
    statusText.textContent = labels[state] || state;

    connectBtn.disabled    = state === 'connected' || state === 'connecting';
    disconnectBtn.disabled = state === 'disconnected';

    if (state === 'connected' && status.tabCount !== undefined) {
      tabInfo.textContent = `Active sessions: ${status.tabCount}`;
    } else {
      tabInfo.textContent = '';
    }

    errorMsg.textContent = status.error || '';
  }

  function checkCdpConflict() {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab) return;
      chrome.storage.session.get([`cdpConflict_${tab.id}`], (data) => {
        if (chrome.runtime.lastError) return;
        cdpWarn.style.display = data[`cdpConflict_${tab.id}`] ? 'block' : 'none';
      });
    });
  }

  function pollStatus() {
    chrome.runtime.sendMessage({ type: 'getStatus' }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res) updateUI(res);
    });
    checkCdpConflict();
  }
  pollStatus();
  setInterval(pollStatus, 1000);

  connectBtn.addEventListener('click', () => {
    const url = serverUrlInput.value.trim();
    const key = apiKeyInput.value.trim();
    if (!key) { errorMsg.textContent = 'Please enter your API key'; return; }

    chrome.storage.local.set({ serverUrl: url, apiKey: key }, () => {
      chrome.runtime.sendMessage({ type: 'connect' }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res) updateUI(res);
      });
    });
  });

  disconnectBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'disconnect' }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res) updateUI(res);
    });
  });
})();
