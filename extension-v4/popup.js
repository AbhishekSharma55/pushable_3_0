(() => {
  const serverUrlInput = document.getElementById('serverUrl');
  const apiKeyInput = document.getElementById('apiKey');
  const connectBtn = document.getElementById('connectBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const statusCard = document.getElementById('statusCard');
  const errorMsg = document.getElementById('errorMsg');

  chrome.storage.local.get(['apiKey'], (data) => { if (data.apiKey) apiKeyInput.value = data.apiKey; });

  function updateUI(s) {
    const state = s.status || 'disconnected';
    statusDot.className = 'dot ' + state;
    statusCard.className = 'status ' + state;
    statusText.textContent = { disconnected: 'Disconnected', connecting: 'Connecting\u2026', connected: 'Connected', error: 'Error' }[state] || state;
    connectBtn.disabled = state === 'connected' || state === 'connecting';
    disconnectBtn.disabled = state === 'disconnected';
    errorMsg.textContent = s.error || '';
  }

  function poll() {
    chrome.runtime.sendMessage({ type: 'getStatus' }, (res) => { if (!chrome.runtime.lastError && res) updateUI(res); });
  }
  poll(); setInterval(poll, 1000);

  connectBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (!key) { errorMsg.textContent = 'Enter API key'; return; }
    chrome.storage.local.set({ serverUrl: serverUrlInput.value.trim(), apiKey: key }, () => {
      chrome.runtime.sendMessage({ type: 'connect' }, (res) => { if (!chrome.runtime.lastError && res) updateUI(res); });
    });
  });

  disconnectBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'disconnect' }, (res) => { if (!chrome.runtime.lastError && res) updateUI(res); });
  });
})();
