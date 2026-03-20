/**
 * Extension Bridge — Main Export
 *
 * Clean re-exports for easy consumption:
 *
 *   import { ExtensionBridge, buildExtensionBrowserTools } from './extension-bridge';
 */

export { ExtensionBridge } from './bridge.js';
export { BridgeServer } from './server.js';
export { buildExtensionBrowserTools } from './tools.js';
export type {
  BridgeConfig,
  BridgeCommand,
  BridgeResult,
  BridgeFrame,
  BridgeStatusMessage,
  BridgePong,
  ExtensionMessage,
  BridgeEvents,
  ConnectionState,
  CommandResult,
} from './types.js';
