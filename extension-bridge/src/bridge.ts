/**
 * Extension Bridge — High-Level Bridge API
 *
 * Wraps the BridgeServer to provide promise-based command execution,
 * connection management, and frame streaming.
 */

import { randomUUID } from 'crypto';
import { BridgeServer } from './server.js';
import type {
  BridgeConfig,
  BridgeResult,
  BridgeFrame,
  ConnectionState,
  CommandResult,
  BridgeStatusMessage,
} from './types.js';

interface PendingCommand {
  resolve: (result: CommandResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ExtensionBridge {
  private server: BridgeServer;
  private pending: Map<string, PendingCommand> = new Map();
  private latestFrame: BridgeFrame | null = null;
  private frameCallbacks: Set<(frame: BridgeFrame) => void> = new Set();
  private connectionMetadata: BridgeStatusMessage['metadata'] | undefined;
  private config: Required<Omit<BridgeConfig, 'backendUrl' | 'apiKey'>> & {
    apiKey?: string;
    backendUrl?: string;
  };

  constructor(config: Partial<BridgeConfig> = {}) {
    this.config = {
      port: config.port ?? 3001,
      apiKey: config.apiKey,
      backendUrl: config.backendUrl,
      heartbeatInterval: config.heartbeatInterval ?? 10000,
      commandTimeout: config.commandTimeout ?? 30000,
      enableFrames: config.enableFrames ?? true,
    };

    this.server = new BridgeServer(this.config);
    this.setupListeners();
  }

  // --- Lifecycle ---

  /** Start the bridge server */
  async start(): Promise<void> {
    await this.server.start();
  }

  /** Stop the bridge server and clean up */
  stop(): void {
    // Reject all pending commands
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Bridge is shutting down'));
      this.pending.delete(id);
    }
    this.frameCallbacks.clear();
    this.server.stop();
  }

  // --- Connection ---

  /** Get the current connection state */
  getConnectionStatus(): ConnectionState {
    return this.server.getState();
  }

  /** Check if the extension is connected */
  isConnected(): boolean {
    return this.server.isConnected();
  }

  /** Get metadata from the connected extension (version, user agent, etc.) */
  getMetadata(): BridgeStatusMessage['metadata'] | undefined {
    return this.connectionMetadata;
  }

  /**
   * Ensure the extension is connected.
   * Throws a descriptive error with connection instructions if not.
   */
  ensureConnected(): void {
    if (!this.isConnected()) {
      throw new Error(
        `[EXTENSION NOT CONNECTED] The Chrome Browser Agent extension is not connected to the bridge server.\n\n` +
        `To connect:\n` +
        `1. Open Google Chrome\n` +
        `2. Click the Browser Agent extension icon in the toolbar\n` +
        `3. Enter the server URL: ${process.env.EXTENSION_BRIDGE_PUBLIC_URL || `wss://ws.pushable.ai`}\n` +
        `4. Click "Connect"\n` +
        `5. Wait for the status to show "Connected"\n\n` +
        `Once connected, try your request again.`
      );
    }
  }

  /**
   * Wait for the extension to connect.
   * Resolves when connected, rejects on timeout.
   */
  waitForConnection(timeout: number = 60000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isConnected()) {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        this.server.removeListener('connected', onConnect);
        reject(new Error(`Timed out waiting for extension connection (${timeout}ms)`));
      }, timeout);

      const onConnect = () => {
        clearTimeout(timer);
        resolve();
      };

      this.server.once('connected', onConnect);
    });
  }

  // --- Command Execution ---

  /**
   * Execute a command on the extension and wait for the result.
   *
   * @param action - The action name (navigate, click, type, etc.)
   * @param params - Action-specific parameters
   * @param timeout - Optional timeout override in ms
   * @returns Promise<CommandResult>
   */
  async execute(
    action: string,
    params: Record<string, unknown> = {},
    timeout?: number
  ): Promise<CommandResult> {
    this.ensureConnected();

    const commandId = randomUUID();
    const commandTimeout = timeout ?? this.config.commandTimeout;

    return new Promise<CommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        reject(new Error(`Command '${action}' timed out after ${commandTimeout}ms`));
      }, commandTimeout);

      this.pending.set(commandId, { resolve, reject, timer });

      const sent = this.server.send({
        commandId,
        action,
        ...params,
      });

      if (!sent) {
        clearTimeout(timer);
        this.pending.delete(commandId);
        reject(new Error('Failed to send command — extension may have disconnected'));
      }
    });
  }

  // --- Convenience Methods ---

  /** Navigate to a URL */
  async navigate(url: string, tabId?: number): Promise<CommandResult> {
    return this.execute('navigate', { url, tabId });
  }

  /** Click an element by CSS selector */
  async click(selector: string, tabId?: number): Promise<CommandResult> {
    return this.execute('click', { selector, tabId });
  }

  /** Type text into an input */
  async type(selector: string, text: string, tabId?: number): Promise<CommandResult> {
    return this.execute('type', { selector, text, tabId });
  }

  /** Type text character by character (human-like) */
  async typeChar(selector: string, text: string, delay?: number, tabId?: number): Promise<CommandResult> {
    return this.execute('typeChar', { selector, text, delay: delay ?? 80, tabId });
  }

  /** Get page info (URL, title, HTML, inputs, buttons, links) */
  async getPageInfo(tabId?: number): Promise<CommandResult> {
    return this.execute('getPageInfo', { tabId });
  }

  /** Take a screenshot of the current tab */
  async screenshot(tabId?: number): Promise<CommandResult> {
    return this.execute('screenshot', { tabId });
  }

  /** Scroll the page or an element */
  async scroll(y: number, selector?: string, tabId?: number): Promise<CommandResult> {
    return this.execute('scroll', { y, selector, tabId });
  }

  /** Wait for an element to appear */
  async waitForElement(selector: string, timeout?: number, tabId?: number): Promise<CommandResult> {
    return this.execute('waitForElement', { selector, timeout: timeout ?? 10000, tabId });
  }

  /** Press a keyboard key */
  async keyPress(key: string, tabId?: number): Promise<CommandResult> {
    return this.execute('keyPress', { key, tabId });
  }

  /** Execute JavaScript in the page */
  async evaluate(script: string, tabId?: number): Promise<CommandResult> {
    return this.execute('evaluate', { script, tabId });
  }

  /** Open a new tab */
  async newTab(url?: string, active?: boolean): Promise<CommandResult> {
    return this.execute('newTab', { url, active });
  }

  /** Close a tab */
  async closeTab(tabId: number): Promise<CommandResult> {
    return this.execute('closeTab', { tabId });
  }

  /** Get list of all tabs */
  async getTabList(): Promise<CommandResult> {
    return this.execute('getTabList', {});
  }

  /** Switch to a specific tab */
  async switchTab(tabId: number): Promise<CommandResult> {
    return this.execute('switchTab', { tabId });
  }

  /** Go back to previous page */
  async goBack(tabId?: number): Promise<CommandResult> {
    return this.execute('goBack', { tabId });
  }

  /** Reload the current page */
  async reload(tabId?: number): Promise<CommandResult> {
    return this.execute('reload', { tabId });
  }

  /** Get interactive elements on the page */
  async getElements(tabId?: number): Promise<CommandResult> {
    return this.execute('getElements', { tabId });
  }

  /** Get an attribute from an element */
  async getAttribute(selector: string, attribute: string, tabId?: number): Promise<CommandResult> {
    return this.execute('getAttribute', { selector, attribute, tabId });
  }

  /** Select a dropdown option */
  async select(selector: string, value: string, tabId?: number): Promise<CommandResult> {
    return this.execute('select', { selector, value, tabId });
  }

  /** Hover over an element */
  async hover(selector: string, tabId?: number): Promise<CommandResult> {
    return this.execute('hover', { selector, tabId });
  }

  // --- Frame Stream ---

  /** Get the latest screenshot frame (or null if none received yet) */
  getLatestFrame(): BridgeFrame | null {
    return this.latestFrame;
  }

  /** Subscribe to live frame updates */
  onFrame(callback: (frame: BridgeFrame) => void): () => void {
    this.frameCallbacks.add(callback);
    return () => this.frameCallbacks.delete(callback);
  }

  // --- Private ---

  private setupListeners(): void {
    this.server.on('connected', (metadata?: BridgeStatusMessage['metadata']) => {
      this.connectionMetadata = metadata;
    });

    this.server.on('disconnected', () => {
      this.connectionMetadata = undefined;
      this.latestFrame = null;

      // Reject all pending commands on disconnect
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Extension disconnected while command was pending'));
        this.pending.delete(id);
      }
    });

    this.server.on('result', (result: BridgeResult) => {
      const pending = this.pending.get(result.commandId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(result.commandId);
        pending.resolve({
          success: result.success,
          data: result.data,
          error: result.error,
          tabId: result.tabId,
        });
      }
    });

    this.server.on('frame', (frame: BridgeFrame) => {
      this.latestFrame = frame;
      for (const cb of this.frameCallbacks) {
        try { cb(frame); } catch (_) { /* ignore callback errors */ }
      }
    });

    this.server.on('error', (err: Error) => {
      console.error('[ExtensionBridge] Error:', err.message);
    });
  }
}
