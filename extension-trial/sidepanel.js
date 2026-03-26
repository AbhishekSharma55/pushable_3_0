(() => {
  const serverUrlInput = document.getElementById('serverUrl');
  const apiKeyInput = document.getElementById('apiKey');
  const connectBtn = document.getElementById('connectBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const statusDetail = document.getElementById('statusDetail');
  const statusCard = document.getElementById('statusCard');
  const tabCount = document.getElementById('tabCount');
  const infoCard = document.getElementById('infoCard');
  const errorMsg = document.getElementById('errorMsg');

  // Load saved API key
  chrome.storage.local.get(['apiKey'], (data) => {
    if (data.apiKey) apiKeyInput.value = data.apiKey;
  });

  function updateUI(status) {
    const state = status.status || 'disconnected';

    // Dot
    statusDot.className = 'dot ' + state;

    // Card styling
    statusCard.className = 'status-card ' + state;

    // Labels
    const labels = {
      disconnected: 'Disconnected',
      connecting: 'Connecting\u2026',
      connected: 'Connected',
      error: 'Connection Error'
    };
    const details = {
      disconnected: 'Click Connect to start',
      connecting: 'Establishing secure connection\u2026',
      connected: 'Extension is active and streaming',
      error: 'Check your API key and try again'
    };
    statusText.textContent = labels[state] || state;
    statusDetail.textContent = details[state] || '';

    // Buttons
    connectBtn.disabled = state === 'connected' || state === 'connecting';
    disconnectBtn.disabled = state === 'disconnected';

    // Info card
    if (state === 'connected') {
      infoCard.style.display = 'block';
      if (status.tabCount !== undefined) {
        tabCount.textContent = status.tabCount;
      }
    } else {
      infoCard.style.display = 'none';
    }

    // Error
    if (status.error) {
      errorMsg.textContent = status.error;
      errorMsg.classList.add('visible');
    } else {
      errorMsg.classList.remove('visible');
    }
  }

  // Poll status
  function pollStatus() {
    chrome.runtime.sendMessage({ type: 'getStatus' }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res) updateUI(res);
    });
  }
  pollStatus();
  setInterval(pollStatus, 1000);

  // Connect
  connectBtn.addEventListener('click', () => {
    const url = serverUrlInput.value.trim();
    const key = apiKeyInput.value.trim();

    if (!key) {
      errorMsg.textContent = 'Please enter your API key';
      errorMsg.classList.add('visible');
      apiKeyInput.focus();
      return;
    }

    errorMsg.classList.remove('visible');
    chrome.storage.local.set({ serverUrl: url, apiKey: key }, () => {
      chrome.runtime.sendMessage({ type: 'connect' }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res) updateUI(res);
      });
    });
  });

  // Disconnect
  disconnectBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'disconnect' }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res) updateUI(res);
    });
  });

  // Auto-connect if key is saved
  chrome.storage.local.get(['apiKey'], (data) => {
    if (data.apiKey) {
      // Small delay to let the service worker start
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: 'getStatus' }, (res) => {
          if (chrome.runtime.lastError) return;
          if (res && res.status === 'disconnected') {
            connectBtn.click();
          }
        });
      }, 500);
    }
  });
})();
