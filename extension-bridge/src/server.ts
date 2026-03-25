/**
 * Extension Bridge — WebSocket Server (Workspace-Isolated)
 *
 * Each Chrome extension connects with a workspace API key.
 * Commands from the backend include a workspaceId and are routed ONLY
 * to the extension that belongs to that workspace.
 *
 * This prevents cross-workspace browser manipulation.
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

interface ExtensionConnection {
  socket: WebSocket;
  workspaceId: string;
  lastPong: number;
}

export class BridgeServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  /** Map of workspaceId → extension connection (one extension per workspace) */
  private extensions: Map<string, ExtensionConnection> = new Map();
  private backendClient: WebSocket | null = null;
  /** Map of workspaceId → Set of frontend viewer sockets */
  private frontendClients: Map<string, Set<WebSocket>> = new Map();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
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
    for (const [, ext] of this.extensions) {
      try { ext.socket.close(); } catch (_) { /* ignore */ }
    }
    this.extensions.clear();
    if (this.backendClient) {
      try { this.backendClient.close(); } catch (_) { /* ignore */ }
      this.backendClient = null;
    }
    for (const [, clients] of this.frontendClients) {
      for (const client of clients) {
        try { client.close(); } catch (_) { /* ignore */ }
      }
    }
    this.frontendClients.clear();
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    this.log('🛑 Bridge server stopped');
  }

  /** Send a JSON message to the extension for a specific workspace */
  send(message: Record<string, unknown>, workspaceId?: string): boolean {
    // If workspaceId provided, route to that workspace's extension
    if (workspaceId) {
      const ext = this.extensions.get(workspaceId);
      if (!ext || ext.socket.readyState !== WebSocket.OPEN) return false;
      try {
        ext.socket.send(JSON.stringify(message));
        return true;
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
        return false;
      }
    }
    // Legacy: no workspaceId — send to first connected extension (backward compat)
    for (const [, ext] of this.extensions) {
      if (ext.socket.readyState === WebSocket.OPEN) {
        try {
          ext.socket.send(JSON.stringify(message));
          return true;
        } catch (_) { /* try next */ }
      }
    }
    return false;
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

  /** Broadcast to frontend clients for a specific workspace */
  private broadcastToFrontend(data: string, workspaceId?: string): void {
    if (workspaceId) {
      const clients = this.frontendClients.get(workspaceId);
      if (!clients) return;
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          try { client.send(data); } catch (_) { /* ignore */ }
        }
      }
    } else {
      // Legacy: broadcast to all
      for (const [, clients] of this.frontendClients) {
        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN) {
            try { client.send(data); } catch (_) { /* ignore */ }
          }
        }
      }
    }
  }

  /** Check if an extension is currently connected for a workspace */
  isConnected(workspaceId?: string): boolean {
    if (workspaceId) {
      const ext = this.extensions.get(workspaceId);
      return ext !== undefined && ext.socket.readyState === WebSocket.OPEN;
    }
    return this.extensions.size > 0;
  }

  /** Get current connection state */
  getState(): ConnectionState {
    if (this.extensions.size > 0) return 'connected';
    return 'disconnected';
  }

  // --- Private ---

  private async handleConnection(socket: WebSocket, req: IncomingMessage): Promise<void> {
    const url = new URL(req.url || '/', `http://localhost:${this.config.port}`);
    const key = url.searchParams.get('key') || '';
    const role = url.searchParams.get('role'); // e.g. 'backend', 'frontend'
    const queryWorkspaceId = url.searchParams.get('workspaceId') || '';

    // --- Backend connection (internal Docker network) ---
    if (role === 'backend') {
      if (this.backendClient && this.backendClient.readyState === WebSocket.OPEN) {
        this.log('ℹ️  Replacing existing backend connection');
        try { this.backendClient.close(1000, 'Replaced'); } catch (_) { /* ignore */ }
      }
      this.backendClient = socket;
      this.log('📡 Backend system connected to bridge');

      socket.on('message', (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString());
          const targetWorkspaceId = msg.workspaceId as string | undefined;

          if (!targetWorkspaceId) {
            // No workspaceId in command — reject
            this.sendToBackend({
              type: 'result',
              commandId: msg.commandId,
              success: false,
              action: msg.action,
              error: 'No workspaceId in command — cannot route to extension',
            });
            return;
          }

          const ext = this.extensions.get(targetWorkspaceId);
          if (ext && ext.socket.readyState === WebSocket.OPEN) {
            this.log(`📤 → Extension [${msg.action}] cmdId=${(msg.commandId as string)?.slice(0,8)}... selector=${(msg.selector as string)?.slice(0,50) || '-'} text=${(msg.text as string)?.slice(0,30) || '-'}`);
            ext.socket.send(data.toString());
          } else {
            this.sendToBackend({
              type: 'result',
              commandId: msg.commandId,
              success: false,
              action: msg.action,
              error: 'Chrome Extension is not connected for this workspace',
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

    // --- Frontend Live View connection ---
    if (role === 'frontend') {
      const wsId = queryWorkspaceId;
      if (!wsId) {
        this.log(`🚫 Frontend connection rejected: no workspaceId`);
        setTimeout(() => socket.close(4002, 'workspaceId required'), 50);
        return;
      }

      let clients = this.frontendClients.get(wsId);
      if (!clients) {
        clients = new Set();
        this.frontendClients.set(wsId, clients);
      }
      clients.add(socket);
      this.log(`👀 Frontend UI connected for workspace ${wsId.substring(0, 8)}... (Total: ${clients.size})`);

      socket.on('message', (data: Buffer | string) => {
        try {
          const ext = this.extensions.get(wsId);
          if (ext && ext.socket.readyState === WebSocket.OPEN) {
            ext.socket.send(data.toString());
          }
        } catch (err) {
          this.log(`⚠️ Invalid message from frontend UI: ${err}`);
        }
      });

      socket.on('close', () => {
        const c = this.frontendClients.get(wsId);
        if (c) {
          c.delete(socket);
          this.log(`👁️ Frontend UI disconnected for workspace ${wsId.substring(0, 8)}... (Total: ${c.size})`);
          if (c.size === 0) this.frontendClients.delete(wsId);
        }
      });
      return;
    }

    // --- Chrome Extension connection ---
    // Extension MUST provide an API key
    if (!key) {
      this.log(`🚫 Connection rejected: no API key provided`);
      setTimeout(() => socket.close(4001, 'API key is required'), 50);
      return;
    }

    // Validate API key and get workspaceId
    let workspaceId: string | null = null;

    // 1. Dynamic validation via backend
    if (this.config.backendUrl) {
      try {
        const res = await fetch(`${this.config.backendUrl}/api/internal/extension/validate-key?key=${key}`);
        if (res.ok) {
          const body = await res.json();
          if (body.valid && body.workspaceId) {
            workspaceId = body.workspaceId;
          }
        }
      } catch (err) {
        this.log(`⚠️ Failed to validate API key via backend: ${err}`);
      }
    }

    // 2. Static key fallback (no workspace isolation possible)
    if (!workspaceId && this.config.apiKey && key === this.config.apiKey) {
      workspaceId = 'static-key';
    }

    if (!workspaceId) {
      this.log(`🚫 Connection rejected: invalid API key`);
      setTimeout(() => socket.close(4001, 'Invalid API key'), 50);
      return;
    }

    // Replace existing extension for this workspace if any
    const existing = this.extensions.get(workspaceId);
    if (existing && existing.socket.readyState === WebSocket.OPEN) {
      this.log(`⚠️  Replacing existing extension for workspace ${workspaceId.substring(0, 8)}...`);
      try { existing.socket.close(1000, 'Replaced by new connection'); } catch (_) { /* ignore */ }
    }

    const conn: ExtensionConnection = { socket, workspaceId, lastPong: Date.now() };
    this.extensions.set(workspaceId, conn);
    this.log(`✅ Chrome Extension connected for workspace ${workspaceId.substring(0, 8)}... (Total extensions: ${this.extensions.size})`);

    socket.on('pong', () => {
      conn.lastPong = Date.now();
    });

    socket.on('message', (data: Buffer | string) => {
      try {
        const msgStr = data.toString();
        const msg = JSON.parse(msgStr) as ExtensionMessage;

        conn.lastPong = Date.now();

        // Inject workspaceId into the message so backend knows which workspace it came from
        const enrichedMsg = JSON.stringify({ ...msg, workspaceId });

        // Log results from extension
        if (msg.type === 'result') {
          const ok = (msg as any).success ? '✅' : '❌';
          this.log(`📥 ← Extension ${ok} [${(msg as any).action}] cmdId=${((msg as any).commandId as string)?.slice(0,8)}... ${(msg as any).success ? '' : 'error=' + ((msg as any).error || '').slice(0, 80)}`);
        }

        // Forward to backend
        if (this.backendClient && this.backendClient.readyState === WebSocket.OPEN) {
          this.backendClient.send(enrichedMsg);
        }

        // Broadcast to frontend viewers for THIS workspace only
        this.broadcastToFrontend(msgStr, workspaceId);

        // Process locally
        this.handleMessage(msg);
      } catch (err) {
        this.emit('error', new Error(`Invalid message from extension: ${err}`));
      }
    });

    socket.on('close', () => {
      const ext = this.extensions.get(workspaceId!);
      if (ext && ext.socket === socket) {
        this.extensions.delete(workspaceId!);
        this.log(`❌ Chrome Extension disconnected for workspace ${workspaceId!.substring(0, 8)}... (Total extensions: ${this.extensions.size})`);
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
        break;
      default:
        break;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      for (const [, ext] of this.extensions) {
        if (ext.socket.readyState === WebSocket.OPEN) {
          try { ext.socket.ping(); } catch (_) { /* ignore */ }
        }
      }
    }, this.config.heartbeatInterval);
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
