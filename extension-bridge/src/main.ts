/**
 * Extension Bridge — Standalone Entrypoint
 *
 * Starts the WebSocket bridge server. Used as the Docker container entrypoint.
 * 
 * Usage: npx tsx src/main.ts
 */

import 'dotenv/config';
import { ExtensionBridge } from './bridge.js';

const port = parseInt(process.env.BRIDGE_PORT || '3001', 10);
const apiKey = process.env.BRIDGE_API_KEY || '';
const backendUrl = process.env.BACKEND_URL || 'http://backend:4000';

const bridge = new ExtensionBridge({
  port,
  apiKey: apiKey || undefined,
  backendUrl,
});

async function main() {
  await bridge.start();

  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Extension Bridge Server Running                ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
  console.log(`   WebSocket URL:  ws://localhost:${port}`);
  if (apiKey) {
    console.log(`   API Key:        ${apiKey.substring(0, 4)}****`);
  } else {
    console.log('   API Key:        (none — open access)');
  }
  console.log('');
  console.log('   Connect the Chrome Browser Agent extension to this URL.');
  console.log('');
}

main().catch((err) => {
  console.error('Fatal error starting bridge:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  bridge.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  bridge.stop();
  process.exit(0);
});
