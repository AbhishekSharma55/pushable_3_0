/**
 * Extension Bridge — TypeScript Types
 */

// --- Connection ---

export type ConnectionState = 'disconnected' | 'connected' | 'connecting';

export interface BridgeConfig {
  /** WebSocket server port (default: 3001) */
  port: number;
  /** Optional API key for static authentication */
  apiKey?: string;
  /** URL to the Pushable backend for dynamic API key validation */
  backendUrl?: string;
  /** Heartbeat interval in milliseconds (default: 10000) */
  heartbeatInterval?: number;
  /** Command timeout in milliseconds (default: 30000) */
  commandTimeout?: number;
  /** Enable frame streaming reception (default: true) */
  enableFrames?: boolean;
}


// --- Messages: Server → Extension ---

export interface BridgeCommand {
  commandId: string;
  action: string;
  tabId?: number | null;
  [key: string]: unknown;
}

// --- Messages: Extension → Server ---

export interface BridgeResult {
  type: 'result';
  commandId: string;
  success: boolean;
  action: string;
  tabId?: number | null;
  error?: string;
  data?: unknown;
}

export interface BridgeFrame {
  type: 'frame';
  tabId: number;
  data: string; // data:image/jpeg;base64,...
  tabUrl: string;
}

export interface BridgeStatusMessage {
  type: 'status';
  status: 'connected' | 'disconnected';
  metadata?: {
    extensionVersion?: string;
    tabCount?: number;
    userAgent?: string;
  };
}

export interface BridgePong {
  type: 'pong';
  ts: number;
}

export type ExtensionMessage = BridgeResult | BridgeFrame | BridgeStatusMessage | BridgePong;

// --- Events ---

export interface BridgeEvents {
  connected: (metadata?: BridgeStatusMessage['metadata']) => void;
  disconnected: () => void;
  frame: (frame: BridgeFrame) => void;
  result: (result: BridgeResult) => void;
  error: (error: Error) => void;
}

// --- Command Helpers ---

export interface CommandResult {
  success: boolean;
  data?: unknown;
  error?: string;
  tabId?: number | null;
}
