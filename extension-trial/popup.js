(() => {
  const serverUrlInput = document.getElementById('serverUrl');
  const apiKeyInput = document.getElementById('apiKey');
  const connectBtn = document.getElementById('connectBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const tabInfo = document.getElementById('tabInfo');
  const errorMsg = document.getElementById('errorMsg');

  // Load saved values
  chrome.storage.local.get(['serverUrl', 'apiKey'], (data) => {
    if (data.serverUrl) serverUrlInput.value = data.serverUrl;
    if (data.apiKey) apiKeyInput.value = data.apiKey;
  });

  function updateUI(status) {
    statusDot.className = 'dot ' + (status.status || 'disconnected');
    const labels = {
      disconnected: 'Disconnected',
      connecting: 'Connecting\u2026',
      connected: 'Connected',
      error: 'Error'
    };
    statusText.textContent = labels[status.status] || status.status;

    connectBtn.disabled = status.status === 'connected' || status.status === 'connecting';
    disconnectBtn.disabled = status.status === 'disconnected';

    if (status.tabCount !== undefined) {
      tabInfo.textContent = `Tabs: ${status.tabCount}`;
    }
    errorMsg.textContent = status.error || '';
  }

  // Poll status
  function pollStatus() {
    chrome.runtime.sendMessage({ type: 'getStatus' }, (res) => {
      if (res) updateUI(res);
    });
  }
  pollStatus();
  setInterval(pollStatus, 1000);

  // Save and connect
  connectBtn.addEventListener('click', () => {
    const url = serverUrlInput.value.trim();
    const key = apiKeyInput.value.trim();
    if (!url) { errorMsg.textContent = 'Server URL is required'; return; }

    chrome.storage.local.set({ serverUrl: url, apiKey: key }, () => {
      chrome.runtime.sendMessage({ type: 'connect' }, (res) => {
        if (res) updateUI(res);
      });
    });
  });

  disconnectBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'disconnect' }, (res) => {
      if (res) updateUI(res);
    });
  });
})();
