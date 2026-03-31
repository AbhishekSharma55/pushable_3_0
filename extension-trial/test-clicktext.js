/**
 * TEST SCRIPT — paste this in the extension's service worker console
 * (chrome://extensions → click "service worker" link under Pushable AI)
 *
 * BEFORE RUNNING: Open LinkedIn messaging in a tab first
 * (https://www.linkedin.com/messaging/)
 *
 * This tests the clickText functionality directly, bypassing the LLM.
 */

// Test 1: Find and list all interactive elements on the active tab
async function testGetElements() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { console.log('❌ No active tab'); return; }
  console.log(`🔍 Testing on tab: ${tab.url}`);

  // Ensure content script is loaded
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await new Promise(r => setTimeout(r, 500));
  }

  // Get elements
  const result = await new Promise(resolve => {
    chrome.tabs.sendMessage(tab.id, { action: 'getElements' }, resolve);
  });

  console.log('📋 Snapshot preview (first 2000 chars):');
  console.log(result?.snapshot?.slice(0, 2000));

  // Count elements
  const matches = result?.snapshot?.match(/\[\d+\]/g);
  console.log(`\n✅ Found ${matches?.length || 0} elements`);

  // Check for conversation items
  const hasClickable = result?.snapshot?.includes('clickable');
  const hasAbhishek = result?.snapshot?.toLowerCase().includes('abhishek');
  console.log(`📌 Has 'clickable' elements: ${hasClickable}`);
  console.log(`📌 Contains 'abhishek': ${hasAbhishek}`);
}

// Test 2: Click by text (the actual clickText mechanism)
async function testClickText(searchText) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { console.log('❌ No active tab'); return; }

  console.log(`🖱️ Attempting to click text: "${searchText}" on ${tab.url}`);

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id }, world: 'MAIN',
    func: (text) => {
      const candidates = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let node;
      while (node = walker.nextNode()) {
        const el = node;
        const elText = (el.textContent || '').trim().replace(/\s+/g, ' ');
        if (!elText.toLowerCase().includes(text.toLowerCase())) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.width > window.innerWidth * 0.8 && rect.height > window.innerHeight * 0.5) continue;

        const tag = el.tagName;
        const role = el.getAttribute('role') || '';
        const hasTabindex = el.tabIndex >= 0;
        const isInteractive = ['BUTTON', 'A', 'INPUT'].includes(tag) || ['button', 'link', 'menuitem'].includes(role);
        const hasPopup = el.getAttribute('aria-haspopup');
        if (hasPopup === 'true' || hasPopup === 'menu') continue;

        let score = 0;
        if (isInteractive) score += 10;
        if (hasTabindex && !isInteractive) score += 8;
        score += Math.max(0, 5 - Math.floor(elText.length / 50));
        if (elText.toLowerCase().startsWith(text.toLowerCase())) score += 5;

        candidates.push({
          tag: tag.toLowerCase(),
          score,
          text: elText.slice(0, 60),
          tabindex: el.tabIndex,
          role: role || 'none',
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          w: Math.round(rect.width),
          h: Math.round(rect.height)
        });
      }

      candidates.sort((a, b) => b.score - a.score);
      return { found: candidates.length, top5: candidates.slice(0, 5) };
    },
    args: [searchText]
  });

  console.log(`📊 Found ${result.found} candidates for "${searchText}":`);
  result.top5.forEach((c, i) => {
    console.log(`  ${i+1}. [score=${c.score}] <${c.tag}> role=${c.role} tabindex=${c.tabindex} (${c.w}x${c.h}) at (${c.x},${c.y})`);
    console.log(`     text: "${c.text}"`);
  });

  if (result.top5.length > 0) {
    const best = result.top5[0];
    console.log(`\n🎯 Would click: <${best.tag}> at (${best.x}, ${best.y})`);
    console.log(`   To actually click, run: actuallyClick("${searchText}")`);
  }
}

// Test 3: Actually perform the click
async function actuallyClick(searchText) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id }, world: 'MAIN',
    func: (text) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let best = null, bestScore = -1;
      let node;
      while (node = walker.nextNode()) {
        const el = node;
        const elText = (el.textContent || '').trim().replace(/\s+/g, ' ');
        if (!elText.toLowerCase().includes(text.toLowerCase())) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.width > window.innerWidth * 0.8 && rect.height > window.innerHeight * 0.5) continue;
        const hasPopup = el.getAttribute('aria-haspopup');
        if (hasPopup === 'true' || hasPopup === 'menu') continue;

        let score = 0;
        if (['BUTTON', 'A', 'INPUT'].includes(el.tagName)) score += 10;
        if (el.tabIndex >= 0 && !['BUTTON', 'A', 'INPUT'].includes(el.tagName)) score += 8;
        score += Math.max(0, 5 - Math.floor(elText.length / 50));
        if (elText.toLowerCase().startsWith(text.toLowerCase())) score += 5;

        if (score > bestScore) { best = el; bestScore = score; }
      }

      if (!best) return { ok: false, error: 'Not found' };
      best.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = best.getBoundingClientRect();
      best.click();
      return { ok: true, tag: best.tagName.toLowerCase(), x: r.left + r.width/2, y: r.top + r.height/2, text: best.textContent.trim().slice(0, 60) };
    },
    args: [searchText]
  });

  console.log('🖱️ Click result:', result);
}

// Run tests
console.log('=== PUSHABLE AI CLICK TEST ===');
console.log('Commands available:');
console.log('  testGetElements()              — scan page for interactive elements');
console.log('  testClickText("Abhishek")      — find clickable elements matching text');
console.log('  actuallyClick("Abhishek")      — actually click the best match');
console.log('');
console.log('First, make sure LinkedIn messaging is the active tab, then run: testGetElements()');
