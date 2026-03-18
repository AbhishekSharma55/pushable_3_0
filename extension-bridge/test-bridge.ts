/**
 * Extension Bridge — Test Script
 *
 * Run with: npx tsx test-bridge.ts
 *
 * 1. Starts the bridge WebSocket server on port 3001
 * 2. Waits for the Chrome extension to connect
 * 3. Runs a few automation commands to verify everything works
 * 4. Exits
 */

import { ExtensionBridge } from './src/bridge.js';

const bridge = new ExtensionBridge({ port: 3001 });

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║      Extension Bridge — Test Script          ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  // Start the server
  await bridge.start();

  console.log('');
  console.log('📋 To connect the Chrome extension:');
  console.log('   1. Open Chrome');
  console.log('   2. Click the Browser Agent extension icon');
  console.log('   3. Enter URL: ws://localhost:3001');
  console.log('   4. Click Connect');
  console.log('');
  console.log('⏳ Waiting for extension to connect (60s timeout)...');
  console.log('');

  try {
    await bridge.waitForConnection(60000);
  } catch (err) {
    console.error('❌ Connection timed out. Make sure the extension is installed and connected.');
    bridge.stop();
    process.exit(1);
  }

  console.log('✅ Extension connected! Running test commands...');
  console.log('');

  // Test 1: Get tab list
  console.log('── Test 1: Get Tab List ──');
  try {
    const tabs = await bridge.getTabList();
    console.log('Tabs:', JSON.stringify(tabs.data, null, 2));
  } catch (err) {
    console.error('Failed:', err);
  }
  console.log('');

  // Test 2: Get page info
  console.log('── Test 2: Get Page Info ──');
  try {
    const info = await bridge.getPageInfo();
    if (info.success && info.data) {
      const d = info.data as any;
      console.log(`URL: ${d.url}`);
      console.log(`Title: ${d.title}`);
      console.log(`Inputs: ${d.inputs?.length || 0}`);
      console.log(`Buttons: ${d.buttons?.length || 0}`);
      console.log(`Links: ${d.links?.length || 0}`);
    } else {
      console.log('Result:', info);
    }
  } catch (err) {
    console.error('Failed:', err);
  }
  console.log('');

  // Test 3: Navigate to example.com
  console.log('── Test 3: Navigate to example.com ──');
  try {
    const nav = await bridge.navigate('https://example.com');
    console.log('Navigate result:', nav.success ? '✅ Success' : `❌ ${nav.error}`);
  } catch (err) {
    console.error('Failed:', err);
  }
  console.log('');

  // Test 4: Get page info after navigation
  console.log('── Test 4: Verify Navigation ──');
  try {
    const info = await bridge.getPageInfo();
    if (info.success && info.data) {
      const d = info.data as any;
      console.log(`URL: ${d.url}`);
      console.log(`Title: ${d.title}`);
      console.log(`Text preview: ${(d.text || '').substring(0, 200)}`);
    }
  } catch (err) {
    console.error('Failed:', err);
  }
  console.log('');

  // Test 5: Get interactive elements
  console.log('── Test 5: Get Interactive Elements ──');
  try {
    const elems = await bridge.getElements();
    if (elems.success) {
      console.log('Elements:', JSON.stringify(elems.data, null, 2));
    } else {
      console.log('Result:', elems);
    }
  } catch (err) {
    console.error('Failed:', err);
  }
  console.log('');

  // Test 6: Screenshot
  console.log('── Test 6: Screenshot ──');
  try {
    const ss = await bridge.screenshot();
    console.log('Screenshot:', ss.success ? `✅ Captured (${(ss.data as string)?.length || 0} chars)` : `❌ ${ss.error}`);
  } catch (err) {
    console.error('Failed:', err);
  }
  console.log('');

  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     ✅ All tests completed!                  ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  // Keep alive for a few seconds to show frame stream
  console.log('Shutting down in 3 seconds...');
  await new Promise((r) => setTimeout(r, 3000));

  bridge.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  bridge.stop();
  process.exit(1);
});
