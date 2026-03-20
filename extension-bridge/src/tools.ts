/**
 * Extension Bridge — LangGraph Browser Tools
 *
 * Provides LangGraph-compatible DynamicStructuredTool instances that use
 * the ExtensionBridge to automate the real Chrome browser via the extension.
 *
 * Each tool checks for extension connectivity first and returns clear
 * instructions if the extension is not connected.
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ExtensionBridge } from './bridge.js';

/**
 * Build browser automation tools that work through the Chrome extension bridge.
 *
 * @param bridge - An initialized and started ExtensionBridge instance
 * @returns Array of LangGraph-compatible tools
 */
export function buildExtensionBrowserTools(bridge: ExtensionBridge): DynamicStructuredTool[] {
  const safe = async (fn: () => Promise<string>): Promise<string> => {
    try {
      return await fn();
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };

  const formatResult = (result: { success: boolean; data?: unknown; error?: string }): string => {
    if (!result.success) return `Error: ${result.error || 'Unknown error'}`;
    if (result.data === undefined || result.data === null) return 'Success';
    return typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
  };

  return [
    // --- Connection Check ---
    new DynamicStructuredTool({
      name: 'ext_browser_check_connection',
      description:
        'Check if the Chrome Browser Agent extension is connected to the bridge server. ' +
        'Call this FIRST before any other ext_browser_* tool. If not connected, it returns ' +
        'step-by-step instructions for the user to connect the extension.',
      schema: z.object({}),
      func: async () => {
        if (bridge.isConnected()) {
          const meta = bridge.getMetadata();
          return `✅ Extension is connected.${meta ? ` Extension v${meta.extensionVersion}, ${meta.tabCount} tabs open.` : ''}`;
        }
        return (
          `❌ Extension is NOT connected.\n\n` +
          `Please connect the Chrome Browser Agent extension:\n` +
          `1. Open Google Chrome\n` +
          `2. Click the Browser Agent extension icon in the toolbar\n` +
          `3. Enter the server URL: ws://localhost:${bridge['config'].port}\n` +
          `4. Click "Connect"\n` +
          `5. Wait for the status to show "Connected"\n\n` +
          `Once connected, try your request again.`
        );
      },
    }),

    // --- Navigation ---
    new DynamicStructuredTool({
      name: 'ext_browser_navigate',
      description: 'Navigate the real Chrome browser to a URL via the extension.',
      schema: z.object({
        url: z.string().describe('The URL to navigate to'),
        tabId: z.number().optional().describe('Target tab ID (omit for active tab)'),
      }),
      func: async ({ url, tabId }) =>
        safe(async () => formatResult(await bridge.navigate(url, tabId))),
    }),

    // --- Clicking ---
    new DynamicStructuredTool({
      name: 'ext_browser_click',
      description: 'Click an element in the real Chrome browser by CSS selector.',
      schema: z.object({
        selector: z.string().describe('CSS selector of the element to click'),
        tabId: z.number().optional().describe('Target tab ID (omit for active tab)'),
      }),
      func: async ({ selector, tabId }) =>
        safe(async () => formatResult(await bridge.click(selector, tabId))),
    }),

    // --- Typing ---
    new DynamicStructuredTool({
      name: 'ext_browser_type',
      description: 'Type text into an input field in the real Chrome browser. Sets the value instantly.',
      schema: z.object({
        selector: z.string().describe('CSS selector of the input field'),
        text: z.string().describe('Text to type'),
        tabId: z.number().optional().describe('Target tab ID (omit for active tab)'),
      }),
      func: async ({ selector, text, tabId }) =>
        safe(async () => formatResult(await bridge.type(selector, text, tabId))),
    }),

    new DynamicStructuredTool({
      name: 'ext_browser_type_char',
      description: 'Type text character by character (human-like) into an input field. Use this for fields that require keystroke events.',
      schema: z.object({
        selector: z.string().describe('CSS selector of the input field'),
        text: z.string().describe('Text to type'),
        delay: z.number().optional().default(80).describe('Delay between keystrokes in ms'),
        tabId: z.number().optional().describe('Target tab ID (omit for active tab)'),
      }),
      func: async ({ selector, text, delay, tabId }) =>
        safe(async () => formatResult(await bridge.typeChar(selector, text, delay, tabId))),
    }),

    // --- Page Info ---
    new DynamicStructuredTool({
      name: 'ext_browser_get_page_info',
      description:
        'Get detailed information about the current page in Chrome: URL, title, truncated HTML, visible text, input fields, buttons, and links.',
      schema: z.object({
        tabId: z.number().optional().describe('Target tab ID (omit for active tab)'),
      }),
      func: async ({ tabId }) =>
        safe(async () => formatResult(await bridge.getPageInfo(tabId))),
    }),

    // --- Interactive Elements ---
    new DynamicStructuredTool({
      name: 'ext_browser_get_elements',
      description:
        'Get all interactive elements (inputs, buttons, links) on the current page with their CSS selectors. ' +
        'Use this to discover what can be clicked or typed into.',
      schema: z.object({
        tabId: z.number().optional().describe('Target tab ID (omit for active tab)'),
      }),
      func: async ({ tabId }) =>
        safe(async () => formatResult(await bridge.getElements(tabId))),
    }),

    // --- Screenshot ---
    new DynamicStructuredTool({
      name: 'ext_browser_screenshot',
      description: 'Take a JPEG screenshot of the currently visible tab in Chrome.',
      schema: z.object({
        tabId: z.number().optional().describe('Target tab ID (omit for active tab)'),
      }),
      func: async ({ tabId }) =>
        safe(async () => {
          const result = await bridge.screenshot(tabId);
          if (!result.success) return `Error: ${result.error}`;
          return 'Screenshot captured successfully. The image data is available in the frame stream.';
        }),
    }),

    // --- Scrolling ---
    new DynamicStructuredTool({
      name: 'ext_browser_scroll',
      description: 'Scroll the page or an element in Chrome. Use positive y for down, negative for up.',
      schema: z.object({
        y: z.number().describe('Pixels to scroll (positive=down, negative=up)'),
        selector: z.string().optional().describe('CSS selector to scroll within (omit for window)'),
        tabId: z.number().optional().describe('Target tab ID (omit for active tab)'),
      }),
      func: async ({ y, selector, tabId }) =>
        safe(async () => formatResult(await bridge.scroll(y, selector, tabId))),
    }),

    // --- Wait ---
    new DynamicStructuredTool({
      name: 'ext_browser_wait_for_element',
      description: 'Wait for an element to appear on the page in Chrome.',
      schema: z.object({
        selector: z.string().describe('CSS selector to wait for'),
        timeout: z.number().optional().default(10000).describe('Timeout in ms'),
        tabId: z.number().optional().describe('Target tab ID (omit for active tab)'),
      }),
      func: async ({ selector, timeout, tabId }) =>
        safe(async () => formatResult(await bridge.waitForElement(selector, timeout, tabId))),
    }),

    // --- Keyboard ---
    new DynamicStructuredTool({
      name: 'ext_browser_key_press',
      description: 'Press a keyboard key in Chrome (e.g. Enter, Tab, Escape, ArrowDown).',
      schema: z.object({
        key: z.string().describe('Key to press (Enter, Tab, Escape, ArrowDown, etc.)'),
        tabId: z.number().optional().describe('Target tab ID (omit for active tab)'),
      }),
      func: async ({ key, tabId }) =>
        safe(async () => formatResult(await bridge.keyPress(key, tabId))),
    }),

    // --- JavaScript ---
    new DynamicStructuredTool({
      name: 'ext_browser_evaluate',
      description: 'Execute JavaScript code in the current page context in Chrome.',
      schema: z.object({
        script: z.string().describe('JavaScript code to execute'),
        tabId: z.number().optional().describe('Target tab ID (omit for active tab)'),
      }),
      func: async ({ script, tabId }) =>
        safe(async () => formatResult(await bridge.evaluate(script, tabId))),
    }),

    // --- Tab Management ---
    new DynamicStructuredTool({
      name: 'ext_browser_new_tab',
      description: 'Open a new tab in Chrome.',
      schema: z.object({
        url: z.string().optional().describe('URL to open (omit for blank tab)'),
        active: z.boolean().optional().default(true).describe('Whether to focus the new tab'),
      }),
      func: async ({ url, active }) =>
        safe(async () => formatResult(await bridge.newTab(url, active))),
    }),

    new DynamicStructuredTool({
      name: 'ext_browser_close_tab',
      description: 'Close a specific tab in Chrome by its tab ID.',
      schema: z.object({
        tabId: z.number().describe('Tab ID to close'),
      }),
      func: async ({ tabId }) =>
        safe(async () => formatResult(await bridge.closeTab(tabId))),
    }),

    new DynamicStructuredTool({
      name: 'ext_browser_get_tabs',
      description: 'List all open tabs in Chrome with their IDs, URLs, and titles.',
      schema: z.object({}),
      func: async () =>
        safe(async () => formatResult(await bridge.getTabList())),
    }),

    new DynamicStructuredTool({
      name: 'ext_browser_switch_tab',
      description: 'Switch to a specific tab in Chrome by its tab ID.',
      schema: z.object({
        tabId: z.number().describe('Tab ID to switch to'),
      }),
      func: async ({ tabId }) =>
        safe(async () => formatResult(await bridge.switchTab(tabId))),
    }),

    // --- Navigation ---
    new DynamicStructuredTool({
      name: 'ext_browser_go_back',
      description: 'Navigate back to the previous page in Chrome.',
      schema: z.object({
        tabId: z.number().optional().describe('Target tab ID (omit for active tab)'),
      }),
      func: async ({ tabId }) =>
        safe(async () => formatResult(await bridge.goBack(tabId))),
    }),

    new DynamicStructuredTool({
      name: 'ext_browser_reload',
      description: 'Reload the current page in Chrome.',
      schema: z.object({
        tabId: z.number().optional().describe('Target tab ID (omit for active tab)'),
      }),
      func: async ({ tabId }) =>
        safe(async () => formatResult(await bridge.reload(tabId))),
    }),

    // --- Select & Hover ---
    new DynamicStructuredTool({
      name: 'ext_browser_select',
      description: 'Select a dropdown option by value in Chrome.',
      schema: z.object({
        selector: z.string().describe('CSS selector of the <select> element'),
        value: z.string().describe('Option value to select'),
        tabId: z.number().optional().describe('Target tab ID (omit for active tab)'),
      }),
      func: async ({ selector, value, tabId }) =>
        safe(async () => formatResult(await bridge.select(selector, value, tabId))),
    }),

    new DynamicStructuredTool({
      name: 'ext_browser_hover',
      description: 'Hover over an element in Chrome.',
      schema: z.object({
        selector: z.string().describe('CSS selector of the element to hover'),
        tabId: z.number().optional().describe('Target tab ID (omit for active tab)'),
      }),
      func: async ({ selector, tabId }) =>
        safe(async () => formatResult(await bridge.hover(selector, tabId))),
    }),
  ];
}
