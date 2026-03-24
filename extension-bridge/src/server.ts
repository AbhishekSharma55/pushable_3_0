/**
 * Extension Bridge — WebSocket Server
 *
 * Creates a WebSocket server that the Chrome Browser Agent extension connects to.
 * Handles connection lifecycle, heartbeat, API key auth, and message routing.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';
import type { IncomingMessage } from 'http';
import type {
  BridgeConfig,
  ConnectionState,
  ExtensionMessage,
  BridgeResult,
  BridgeFrame,
  BridgeStatusMessage,
} from './types.js';

export class BridgeServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private extensionClient: WebSocket | null = null;
  private backendClient: WebSocket | null = null;
  private frontendClients: Set<WebSocket> = new Set();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastPong: number = 0;
  private config: Required<Omit<BridgeConfig, 'backendUrl' | 'apiKey'>> & {
    apiKey?: string;
    backendUrl?: string;
  };

  constructor(config: Partial<BridgeConfig> = {}) {
    super();
    this.config = {
      port: config.port ?? 3001,
      apiKey: config.apiKey,
      backendUrl: config.backendUrl,
      heartbeatInterval: config.heartbeatInterval ?? 10000,
      commandTimeout: config.commandTimeout ?? 30000,
      enableFrames: config.enableFrames ?? true,
    };
  }

  /** Start the WebSocket server */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port: this.config.port });

        this.wss.on('listening', () => {
          this.log(`🌐 Bridge server listening on ws://localhost:${this.config.port}`);
          this.startHeartbeat();
          resolve();
        });

        this.wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
          this.handleConnection(socket, req);
        });

        this.wss.on('error', (err: Error) => {
          this.emit('error', err);
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /** Stop the server and disconnect */
  stop(): void {
    this.stopHeartbeat();
    if (this.extensionClient) {
      try { this.extensionClient.close(); } catch (_) { /* ignore */ }
      this.extensionClient = null;
    }
    if (this.backendClient) {
      try { this.backendClient.close(); } catch (_) { /* ignore */ }
      this.backendClient = null;
    }
    for (const client of this.frontendClients) {
      try { client.close(); } catch (_) { /* ignore */ }
    }
    this.frontendClients.clear();
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    this.log('🛑 Bridge server stopped');
  }

  /** Send a JSON message to the connected extension */
  send(message: Record<string, unknown>): boolean {
    if (!this.extensionClient || this.extensionClient.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      this.extensionClient.send(JSON.stringify(message));
      return true;
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }

  /** Send a JSON message to the connected backend */
  sendToBackend(message: Record<string, unknown>): boolean {
    if (!this.backendClient || this.backendClient.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      this.backendClient.send(JSON.stringify(message));
      return true;
    } catch (err) {
      return false;
    }
  }

  /** Broadcast a raw JSON string buffer to all connected frontend UI clients */
  private broadcastToFrontend(data: string): void {
    for (const client of this.frontendClients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(data);
        } catch (_) { /* ignore dead sockets */ }
      }
    }
  }

  /** Check if an extension is currently connected */
  isConnected(): boolean {
    return this.extensionClient !== null && this.extensionClient.readyState === WebSocket.OPEN;
  }

  /** Get current connection state */
  getState(): ConnectionState {
    if (this.extensionClient && this.extensionClient.readyState === WebSocket.OPEN) return 'connected';
    if (this.extensionClient && this.extensionClient.readyState === WebSocket.CONNECTING) return 'connecting';
    return 'disconnected';
  }

  // --- Private ---

  private async handleConnection(socket: WebSocket, req: IncomingMessage): Promise<void> {
    const url = new URL(req.url || '/', `http://localhost:${this.config.port}`);
    const key = url.searchParams.get('key') || '';
    const role = url.searchParams.get('role'); // e.g. 'backend'

    // API key validation
    let isAuthorized = false;

    // 1. Dynamic Validation if backend URL is provided
    if (this.config.backendUrl && key) {
      try {
        const res = await fetch(`${this.config.backendUrl}/api/internal/extension/validate-key?key=${key}`);
        if (res.ok) {
          const body = await res.json();
          if (body.valid) isAuthorized = true;
        }
      } catch (err) {
        this.log(`⚠️ Failed to validate API key via backend: ${err}`);
      }
    }

    // 2. Static Validation fallback
    if (!isAuthorized && this.config.apiKey && key === this.config.apiKey) {
      isAuthorized = true;
    }

    // Backend and frontend roles connect from internal Docker network — skip key validation for them
    if (role === 'backend' || role === 'frontend') {
      isAuthorized = true;
    }

    // Reject if neither validation method passed (authentication enforced if static key OR backend URL is configured)
    const authRequired = !!this.config.apiKey || !!this.config.backendUrl;
    if (authRequired && !isAuthorized) {
      this.log(`🚫 Connection rejected: invalid API key (Role: ${role || 'extension'})`);
      // Delay closing by 50ms so the HTTP Upgrade response has time to flush to the client.
      // Otherwise Chrome receives a TCP RST and surfaces a 1006 error instead of our 4001 code.
      setTimeout(() => {
        socket.close(4001, 'Invalid API key');
      }, 50);
      return;
    }

    if (role === 'backend') {
      // Handle Pushable Backend connection
      if (this.backendClient && this.backendClient.readyState === WebSocket.OPEN) {
        this.log('ℹ️  Replacing existing backend connection');
        try { this.backendClient.close(1000, 'Replaced'); } catch (_) { /* ignore */ }
      }
      this.backendClient = socket;
      this.log('📡 Backend system connected to bridge');

      socket.on('message', (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString());
          // The backend sends commands. Forward them directly to the extension.
          if (this.extensionClient && this.extensionClient.readyState === WebSocket.OPEN) {
            this.extensionClient.send(data.toString());
          } else {
            // Extension isn't connected; send an error back instantly so the agent doesn't hang
            this.sendToBackend({
              type: 'result',
              commandId: msg.commandId,
              success: false,
              action: msg.action,
              error: 'Chrome Extension is not connected to the bridge',
            });
          }
        } catch (err) {
          this.emit('error', new Error(`Invalid message from backend: ${err}`));
        }
      });

      socket.on('close', () => {
        if (this.backendClient === socket) {
          this.backendClient = null;
          this.log('❌ Backend system disconnected');
        }
      });
      return;
    }

    if (role === 'frontend') {
      // Handle Frontend Live View connection
      this.frontendClients.add(socket);
      this.log(`👀 Frontend UI connected (Total: ${this.frontendClients.size})`);

      socket.on('message', (data: Buffer | string) => {
        try {
          // A user clicked/typed on the live view video feed in the dashboard.
          // Forward that command directly into the extension.
          if (this.extensionClient && this.extensionClient.readyState === WebSocket.OPEN) {
            this.extensionClient.send(data.toString());
          }
        } catch (err) {
          this.log(`⚠️ Invalid message from frontend UI: ${err}`);
        }
      });

      socket.on('close', () => {
        this.frontendClients.delete(socket);
        this.log(`👁️ Frontend UI disconnected (Total: ${this.frontendClients.size})`);
      });
      return;
    }

    // Default: Handle Chrome Extension connection
    if (this.extensionClient && this.extensionClient.readyState === WebSocket.OPEN) {
      this.log('⚠️  Replacing existing extension connection with new one');
      try { this.extensionClient.close(1000, 'Replaced by new connection'); } catch (_) { /* ignore */ }
    }

    this.extensionClient = socket;
    this.lastPong = Date.now();
    this.log('✅ Chrome Extension connected');

    // Track WebSocket-level pong responses (browser handles these even when service worker is suspended)
    socket.on('pong', () => {
      this.lastPong = Date.now();
    });

    socket.on('message', (data: Buffer | string) => {
      try {
        const msgStr = data.toString();
        const msg = JSON.parse(msgStr) as ExtensionMessage;

        // Update lastPong on any message (extension is clearly alive)
        this.lastPong = Date.now();

        // Forward back to backend if connected (the backend sent the command)
        if (this.backendClient && this.backendClient.readyState === WebSocket.OPEN) {
           this.backendClient.send(msgStr);
        }

        // Broadcast to all connected frontend dashboards (Live View + Result logs)
        this.broadcastToFrontend(msgStr);

        // Process locally for the internal programmatic API
        this.handleMessage(msg);
      } catch (err) {
        this.emit('error', new Error(`Invalid message from extension: ${err}`));
      }
    });

    socket.on('close', () => {
      if (this.extensionClient === socket) {
        this.extensionClient = null;
        this.log('❌ Chrome Extension disconnected');
        this.emit('disconnected');
      }
    });

    socket.on('error', (err: Error) => {
      this.emit('error', err);
    });
  }

  private handleMessage(msg: ExtensionMessage): void {
    switch (msg.type) {
      case 'status':
        this.emit('status', msg as BridgeStatusMessage);
        if ((msg as BridgeStatusMessage).status === 'connected') {
          this.emit('connected', (msg as BridgeStatusMessage).metadata);
        }
        break;
      case 'result':
        this.emit('result', msg as BridgeResult);
        break;
      case 'frame':
        if (this.config.enableFrames) {
          this.emit('frame', msg as BridgeFrame);
        }
        break;
      case 'pong':
        this.lastPong = Date.now();
        break;
      default:
        // Unknown message type - ignore
        break;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    // Use WebSocket-level ping/pong instead of app-level messages.
    // This works even when Chrome's Manifest V3 service worker is suspended,
    // because the browser's WebSocket implementation handles pong frames natively.
    this.heartbeatTimer = setInterval(() => {
      if (!this.extensionClient || this.extensionClient.readyState !== WebSocket.OPEN) return;

      // Use WebSocket protocol-level ping (handled by browser, not service worker JS)
      try {
        this.extensionClient.ping();
      } catch (_) { /* ignore */ }
    }, this.config.heartbeatInterval);

    // Listen for pong at the WebSocket protocol level
    // Note: we set this up per-connection in handleConnection instead
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private log(msg: string): void {
    const ts = new Date().toISOString().substring(11, 19);
    console.log(`[${ts}] ${msg}`);
  }
}
