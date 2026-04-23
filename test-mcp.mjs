/**
 * test-mcp.mjs — Local MCP tool call test
 *
 * Tests the complete flow:
 *   Claude receives task → calls browser tools → gets mock results → completes task
 *
 * No server, no extension, no MCP library needed.
 * Mock browser responses simulate what the real extension would return.
 *
 * Run: node test-mcp.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';

// ── Load API key from .env ────────────────────────────────────────────────────
let ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
let OPENROUTER_KEY = process.env.OPENROUTER_KEY;

// Try reading .env manually if not set
try {
  const env = readFileSync('.env', 'utf8');
  for (const line of env.split('\n')) {
    const [k, ...v] = line.split('=');
    if (k?.trim() === 'ANTHROPIC_API_KEY' && v.join('=').trim()) ANTHROPIC_KEY = v.join('=').trim();
    if (k?.trim() === 'OPENROUTER_KEY'   && v.join('=').trim()) OPENROUTER_KEY = v.join('=').trim();
  }
} catch {}

// Use Anthropic directly if key exists, otherwise use OpenRouter
const useOpenRouter = !ANTHROPIC_KEY && !!OPENROUTER_KEY;
const client = useOpenRouter
  ? new Anthropic({ apiKey: OPENROUTER_KEY, baseURL: 'https://openrouter.ai/api/v1' })
  : new Anthropic({ apiKey: ANTHROPIC_KEY });

const MODEL = useOpenRouter
  ? 'anthropic/claude-sonnet-4-5'
  : 'claude-sonnet-4-5-20251022';

console.log(`Using: ${useOpenRouter ? 'OpenRouter' : 'Anthropic'} → ${MODEL}\n`);

// ── Mock browser state (simulates what your extension would return) ────────────
// Change SCENARIO to test different situations
const SCENARIO = process.argv[2] || 'reddit-vote';

const SCENARIOS = {
  'reddit-vote': {
    task: 'Downvote the post on the current page',
    pages: [
      // Page state BEFORE downvote
      {
        url: 'https://reddit.com/r/openclaw/comments/1r0wks3/',
        title: 'Does OpenClaw actually do anything for you guys?',
        snapshot: `PAGE: https://reddit.com/r/openclaw/comments/1r0wks3/
TITLE: Does OpenClaw actually do anything for you guys?

ELEMENTS (use [N] as selector):
  [1] button "Upvote" pressed=false
  [2] button "Downvote" pressed=false
  [3] button "Share"
  [4] button "Comments 517"
  [5] link "r/openclaw"
  [6] button "Join"`,
      },
      // Page state AFTER downvote (what the extension returns on re-scan)
      {
        url: 'https://reddit.com/r/openclaw/comments/1r0wks3/',
        title: 'Does OpenClaw actually do anything for you guys?',
        snapshot: `PAGE: https://reddit.com/r/openclaw/comments/1r0wks3/
TITLE: Does OpenClaw actually do anything for you guys?

ELEMENTS (use [N] as selector):
  [1] button "Upvote" pressed=false
  [2] button "Downvote" pressed=true
  [3] button "Share"
  [4] button "Comments 517"
  [5] link "r/openclaw"
  [6] button "Join"`,
      },
    ],
  },

  'google-search': {
    task: 'Search for "pushable ai" on Google and click the first result',
    pages: [
      {
        url: 'https://google.com',
        title: 'Google',
        snapshot: `PAGE: https://google.com
TITLE: Google

ELEMENTS (use [N] as selector):
  [1] searchBox "Search" placeholder="Search Google or type a URL"
  [2] button "Google Search"
  [3] button "I'm Feeling Lucky"`,
      },
      {
        url: 'https://google.com/search?q=pushable+ai',
        title: 'pushable ai - Google Search',
        snapshot: `PAGE: https://google.com/search?q=pushable+ai
TITLE: pushable ai - Google Search

ELEMENTS (use [N] as selector):
  [1] link "Pushable AI — AI Employee Platform" href=https://platform.pushable.ai
  [2] link "Pushable AI - Build AI Employees" href=https://www.pushable.ai
  [3] link "GitHub - pushable/pushable-ai" href=https://github.com/pushable
  [4] searchBox "Search" value="pushable ai"
  [5] button "Google Search"`,
      },
      {
        url: 'https://platform.pushable.ai',
        title: 'Pushable AI — AI Employee Platform',
        snapshot: `PAGE: https://platform.pushable.ai
TITLE: Pushable AI — AI Employee Platform

ELEMENTS (use [N] as selector):
  [1] button "Sign In"
  [2] button "Get Started Free"
  [3] link "Pricing"
  [4] link "Docs"`,
      },
    ],
  },

  'form-fill': {
    task: 'Fill in the contact form with name "John" and email "john@test.com" then submit',
    pages: [
      {
        url: 'https://example.com/contact',
        title: 'Contact Us',
        snapshot: `PAGE: https://example.com/contact
TITLE: Contact Us

ELEMENTS (use [N] as selector):
  [1] textBox "Name" placeholder="Your name"
  [2] textBox "Email" placeholder="your@email.com"
  [3] textBox "Message" placeholder="Your message..."
  [4] button "Send Message"`,
      },
      {
        url: 'https://example.com/contact',
        title: 'Contact Us',
        snapshot: `PAGE: https://example.com/contact
TITLE: Contact Us

ELEMENTS (use [N] as selector):
  [1] textBox "Name" value="John"
  [2] textBox "Email" placeholder="your@email.com"
  [3] textBox "Message" placeholder="Your message..."
  [4] button "Send Message"`,
      },
      {
        url: 'https://example.com/contact',
        title: 'Contact Us',
        snapshot: `PAGE: https://example.com/contact
TITLE: Contact Us

ELEMENTS (use [N] as selector):
  [1] textBox "Name" value="John"
  [2] textBox "Email" value="john@test.com"
  [3] textBox "Message" placeholder="Your message..."
  [4] button "Send Message"`,
      },
      {
        url: 'https://example.com/thank-you',
        title: 'Thank You!',
        snapshot: `PAGE: https://example.com/thank-you
TITLE: Thank You!

ELEMENTS (use [N] as selector):
  [1] link "Back to Home"`,
      },
    ],
  },
};

const scenario = SCENARIOS[SCENARIO];
if (!scenario) {
  console.log(`Unknown scenario. Available: ${Object.keys(SCENARIOS).join(', ')}`);
  process.exit(1);
}

// ── Mock browser execution ────────────────────────────────────────────────────
let pageIndex = 0; // tracks which mock page state we're on
const actionLog = []; // records every tool call

function executeTool(name, input) {
  const page = SCENARIOS[SCENARIO].pages[pageIndex];

  switch (name) {
    case 'browser_snapshot':
    case 'browser_get_elements': {
      console.log(`  📋 SNAPSHOT returned (page ${pageIndex + 1}/${scenario.pages.length})`);
      return { snapshot: page.snapshot };
    }

    case 'browser_click': {
      const selector = input.selector || input.elementId;
      console.log(`  🖱️  CLICK [${selector}]`);
      // Advance to next mock page state after a click (simulates DOM change)
      if (pageIndex < scenario.pages.length - 1) pageIndex++;
      return { ok: true, selector };
    }

    case 'browser_type': {
      console.log(`  ⌨️  TYPE [${input.selector || input.elementId}] → "${input.text}"`);
      if (pageIndex < scenario.pages.length - 1) pageIndex++;
      return { ok: true };
    }

    case 'browser_navigate': {
      console.log(`  🌐 NAVIGATE → ${input.url}`);
      if (pageIndex < scenario.pages.length - 1) pageIndex++;
      return { ok: true, url: input.url };
    }

    case 'browser_scroll': {
      console.log(`  📜 SCROLL ${input.direction || 'down'} ${input.amount || input.px || 300}px`);
      return { ok: true };
    }

    case 'browser_screenshot': {
      console.log(`  📸 SCREENSHOT (mock — returning placeholder)`);
      return { ok: true, note: 'screenshot not available in mock mode' };
    }

    case 'browser_keypress': {
      console.log(`  ⌨️  KEYPRESS ${input.key}`);
      return { ok: true };
    }

    case 'browser_hover': {
      console.log(`  🖱️  HOVER [${input.selector || input.elementId}]`);
      return { ok: true };
    }

    case 'browser_wait': {
      console.log(`  ⏳ WAIT ${input.ms || 1000}ms`);
      return { ok: true };
    }

    case 'task_done': {
      console.log(`  ✅ TASK DONE: "${input.result}"`);
      return { done: true, result: input.result };
    }

    default:
      console.log(`  ❓ UNKNOWN TOOL: ${name}`);
      return { error: `Unknown tool: ${name}` };
  }
}

// ── Tool definitions (what Claude sees) ──────────────────────────────────────
const TOOLS = [
  {
    name: 'browser_snapshot',
    description: 'Get the current page URL, title, and all interactive elements as a numbered list. Always call this first to see what is on the page.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_click',
    description: 'Click an element by its [N] ID from the snapshot.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Element ID like [3] or just 3' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into an input element. Clears existing content first.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Element ID from snapshot' },
        text: { type: 'string', description: 'Text to type' },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'browser_navigate',
    description: 'Navigate the browser to a URL.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the page.',
    input_schema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down'] },
        amount: { type: 'number', description: 'Pixels to scroll, default 300' },
      },
      required: ['direction'],
    },
  },
  {
    name: 'browser_keypress',
    description: 'Press a keyboard key (Enter, Tab, Escape, etc.).',
    input_schema: {
      type: 'object',
      properties: { key: { type: 'string' } },
      required: ['key'],
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the current page.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'task_done',
    description: 'Call this when the task is fully complete. Describe what was accomplished.',
    input_schema: {
      type: 'object',
      properties: { result: { type: 'string', description: 'Summary of what was done' } },
      required: ['result'],
    },
  },
];

// ── Agent loop ────────────────────────────────────────────────────────────────
async function runTask(task) {
  console.log('═'.repeat(60));
  console.log(`TASK: ${task}`);
  console.log(`SCENARIO: ${SCENARIO}`);
  console.log('═'.repeat(60) + '\n');

  const messages = [{ role: 'user', content: task }];
  let stepCount = 0;

  for (let step = 0; step < 20; step++) {
    stepCount++;
    console.log(`\n── Step ${stepCount} ─────────────────────────────────────`);

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      tools: TOOLS,
      messages,
      system: `You control a real browser via tools. Complete the given task efficiently.

Rules:
1. ALWAYS call browser_snapshot first to see the current page state
2. After every click, call browser_snapshot again to verify the action worked
3. Check element states (pressed=true/false, value, etc.) to confirm success
4. Never click the same element more than twice
5. Call task_done as soon as the task is complete with a clear description of what happened`,
    });

    // Add assistant response to history
    messages.push({ role: 'assistant', content: response.content });

    // Show Claude's reasoning
    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) {
        console.log(`\n💭 Claude: ${block.text.trim()}`);
      }
    }

    // Process tool calls
    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;

      console.log(`\n🔧 Tool call: ${block.name}(${JSON.stringify(block.input)})`);
      actionLog.push({ step: stepCount, tool: block.name, input: block.input });

      const result = executeTool(block.name, block.input);

      if (block.name === 'task_done') {
        console.log('\n' + '═'.repeat(60));
        console.log(`COMPLETED in ${stepCount} steps, ${actionLog.length} tool calls`);
        console.log('═'.repeat(60));
        console.log('\nAll tool calls made:');
        actionLog.forEach((a, i) => {
          console.log(`  ${i + 1}. ${a.tool}(${JSON.stringify(a.input)})`);
        });
        return result;
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }

    if (toolResults.length > 0) {
      messages.push({ role: 'user', content: toolResults });
    }

    if (response.stop_reason === 'end_turn') {
      console.log('\n⚠️  Claude stopped without calling task_done');
      break;
    }
  }

  console.log('\n⚠️  Max steps reached');
  return null;
}

// ── Run ───────────────────────────────────────────────────────────────────────
runTask(scenario.task).catch(console.error);
