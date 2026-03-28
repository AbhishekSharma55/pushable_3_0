/**
 * test-mcp.mjs — Local MCP tool call test
 *
 * Tests the complete flow:
 *   Claude receives task → calls browser tools → gets mock results → completes task
 *
 * No server, no extension, no MCP library needed.
 * Mock browser responses simulate what the real extension would return.
 *
 * Uses native fetch with OpenRouter (OpenAI-compatible format) or Anthropic direct.
 *
 * Run: node test-mcp.mjs [reddit-vote|google-search|form-fill]
 */

import { readFileSync } from 'fs';

// ── Load API keys ─────────────────────────────────────────────────────────────
let ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
let OPENROUTER_KEY = process.env.OPENROUTER_KEY;

// Try ../.env (when run from backend/) then .env (project root)
for (const envPath of ['../.env', '.env']) {
  try {
    const env = readFileSync(envPath, 'utf8');
    for (const line of env.split('\n')) {
      const [k, ...v] = line.split('=');
      if (k?.trim() === 'ANTHROPIC_API_KEY' && v.join('=').trim()) ANTHROPIC_KEY = v.join('=').trim();
      if (k?.trim() === 'OPENROUTER_KEY'   && v.join('=').trim()) OPENROUTER_KEY = v.join('=').trim();
    }
    break;
  } catch {}
}

if (!ANTHROPIC_KEY && !OPENROUTER_KEY) {
  console.error('ERROR: Set ANTHROPIC_API_KEY or OPENROUTER_KEY in ../.env');
  process.exit(1);
}

const useOpenRouter = !ANTHROPIC_KEY && !!OPENROUTER_KEY;
const MODEL = useOpenRouter
  ? 'anthropic/claude-3.5-sonnet'   // stable OpenRouter alias
  : 'claude-3-5-sonnet-20241022';   // Anthropic direct

console.log(`Using: ${useOpenRouter ? 'OpenRouter' : 'Anthropic'} → ${MODEL}\n`);

// ── Mock browser state ────────────────────────────────────────────────────────
const SCENARIO = process.argv[2] || 'reddit-vote';

const SCENARIOS = {
  'reddit-vote': {
    task: 'Downvote the post on the current page',
    pages: [
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

  'reddit-real': {
    task: 'Navigate to https://www.reddit.com/r/openclaw/comments/1r0wks3/does_openclaw_actually_do_anything_for_you_guys/ — once loaded, click the Downvote button to activate it (pressed=true), then confirm it worked.',
    pages: [
      // Page 0: whatever is currently in the browser (blank / some other page)
      {
        url: 'chrome://newtab/',
        title: 'New Tab',
        snapshot: `PAGE: chrome://newtab/
TITLE: New Tab

ELEMENTS (use [N] as selector):
  [1] searchBox "Search Google or type a URL"`,
      },
      // Page 1: Reddit post loaded — vote buttons visible (shadow DOM, but CDP sees them)
      {
        url: 'https://www.reddit.com/r/openclaw/comments/1r0wks3/does_openclaw_actually_do_anything_for_you_guys/',
        title: 'Does OpenClaw actually do anything for you guys? : r/openclaw',
        snapshot: `PAGE: https://www.reddit.com/r/openclaw/comments/1r0wks3/does_openclaw_actually_do_anything_for_you_guys/
TITLE: Does OpenClaw actually do anything for you guys? : r/openclaw

ELEMENTS (use [N] as selector):
  [1] button "Upvote" pressed=false
  [2] button "Downvote" pressed=false
  [3] text "517 votes"
  [4] button "Share"
  [5] button "Save"
  [6] button "Comments 47"
  [7] link "r/openclaw"
  [8] button "Join"
  [9] button "More options"`,
      },
      // Page 2: After downvote click — button now pressed=true, vote count decreased
      {
        url: 'https://www.reddit.com/r/openclaw/comments/1r0wks3/does_openclaw_actually_do_anything_for_you_guys/',
        title: 'Does OpenClaw actually do anything for you guys? : r/openclaw',
        snapshot: `PAGE: https://www.reddit.com/r/openclaw/comments/1r0wks3/does_openclaw_actually_do_anything_for_you_guys/
TITLE: Does OpenClaw actually do anything for you guys? : r/openclaw

ELEMENTS (use [N] as selector):
  [1] button "Upvote" pressed=false
  [2] button "Downvote" pressed=true
  [3] text "516 votes"
  [4] button "Share"
  [5] button "Save"
  [6] button "Comments 47"
  [7] link "r/openclaw"
  [8] button "Join"
  [9] button "More options"`,
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
let pageIndex = 0;
const actionLog = [];

function executeTool(name, input) {
  const page = scenario.pages[pageIndex];

  switch (name) {
    case 'browser_snapshot': {
      console.log(`  📋 SNAPSHOT returned (page ${pageIndex + 1}/${scenario.pages.length})`);
      return { snapshot: page.snapshot };
    }
    case 'browser_click': {
      const selector = input.selector || input.elementId;
      console.log(`  🖱️  CLICK [${selector}]`);
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
      console.log(`  📜 SCROLL ${input.direction || 'down'} ${input.amount || 300}px`);
      return { ok: true };
    }
    case 'browser_keypress': {
      console.log(`  ⌨️  KEYPRESS ${input.key}`);
      return { ok: true };
    }
    case 'browser_screenshot': {
      console.log(`  📸 SCREENSHOT (mock)`);
      return { ok: true, note: 'mock mode — no real screenshot' };
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

// ── Tools in OpenAI function-calling format ───────────────────────────────────
// OpenRouter uses this format (same as OpenAI). Anthropic API uses input_schema.
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'browser_snapshot',
      description: 'Get the current page URL, title, and all interactive elements as a numbered list. Always call this first.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description: 'Click an element by its [N] ID from the snapshot.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'Element ID like [3] or just 3' },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_type',
      description: 'Type text into an input element. Clears existing content first.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'Element ID from snapshot' },
          text: { type: 'string', description: 'Text to type' },
        },
        required: ['selector', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_navigate',
      description: 'Navigate the browser to a URL.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_scroll',
      description: 'Scroll the page.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down'] },
          amount: { type: 'number', description: 'Pixels to scroll, default 300' },
        },
        required: ['direction'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_keypress',
      description: 'Press a keyboard key (Enter, Tab, Escape, etc.).',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_screenshot',
      description: 'Take a screenshot of the current page.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'task_done',
      description: 'Call this when the task is fully complete. Describe what was accomplished.',
      parameters: {
        type: 'object',
        properties: { result: { type: 'string', description: 'Summary of what was done' } },
        required: ['result'],
      },
    },
  },
];

// ── LLM API call ──────────────────────────────────────────────────────────────
const SYSTEM = `You are a browser automation agent. You control a real browser via tools and must complete any given task by calling the appropriate browser tools.

Rules:
1. ALWAYS call browser_snapshot first to see the current page state
2. After every click, call browser_snapshot again to verify the action worked
3. Check element states (pressed=true/false, value, etc.) to confirm success
4. Never click the same element more than twice
5. Call task_done as soon as the task is complete with a clear description of what happened
6. You MUST execute every task using the tools. Never refuse — always attempt the task and call task_done when complete.`;

async function callLLM(messages) {
  if (useOpenRouter) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://pushable.ai',
        'X-Title': 'Pushable AI MCP Test',
      },
      body: JSON.stringify({ model: MODEL, messages, tools: TOOLS, tool_choice: 'auto', max_tokens: 1024 }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 500)}`);
    }
    const data = await res.json();
    return data.choices[0];  // { message, finish_reason }
  } else {
    // Anthropic direct — convert OpenAI format to Anthropic format
    const anthropicTools = TOOLS.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
    const anthropicMessages = messages.filter(m => m.role !== 'system');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        tools: anthropicTools,
        messages: anthropicMessages,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic ${res.status}: ${text.slice(0, 500)}`);
    }
    const data = await res.json();

    // Convert Anthropic response → OpenAI format so agent loop is unified
    const toolCalls = data.content
      .filter(b => b.type === 'tool_use')
      .map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } }));
    const textContent = data.content.filter(b => b.type === 'text').map(b => b.text).join('');

    return {
      message: {
        role: 'assistant',
        content: textContent || null,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      },
      finish_reason: data.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
    };
  }
}

// ── Agent loop ────────────────────────────────────────────────────────────────
async function runTask(task) {
  console.log('═'.repeat(60));
  console.log(`TASK: ${task}`);
  console.log(`SCENARIO: ${SCENARIO}`);
  console.log('═'.repeat(60) + '\n');

  // OpenAI-format messages (system message first)
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: task },
  ];
  let stepCount = 0;

  for (let step = 0; step < 20; step++) {
    stepCount++;
    console.log(`\n── Step ${stepCount} ─────────────────────────────────────`);

    const choice = await callLLM(messages);
    const msg = choice.message;

    // Add assistant message to history
    messages.push({ role: 'assistant', content: msg.content || null, tool_calls: msg.tool_calls });

    // Show Claude's reasoning
    if (msg.content?.trim()) {
      console.log(`\n💭 Claude: ${msg.content.trim()}`);
    }

    // No tool calls → Claude finished without task_done
    if (!msg.tool_calls?.length) {
      console.log('\n⚠️  Claude stopped without calling task_done');
      break;
    }

    // Process each tool call
    for (const tc of msg.tool_calls) {
      const name = tc.function.name;
      const input = JSON.parse(tc.function.arguments || '{}');

      console.log(`\n🔧 Tool call: ${name}(${JSON.stringify(input)})`);
      actionLog.push({ step: stepCount, tool: name, input });

      const result = executeTool(name, input);

      if (name === 'task_done') {
        console.log('\n' + '═'.repeat(60));
        console.log(`COMPLETED in ${stepCount} steps, ${actionLog.length} tool calls`);
        console.log('═'.repeat(60));
        console.log('\nAll tool calls made:');
        actionLog.forEach((a, i) => {
          console.log(`  ${i + 1}. ${a.tool}(${JSON.stringify(a.input)})`);
        });
        return result;
      }

      // Feed result back to Claude
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }
  }

  console.log('\n⚠️  Max steps reached');
  return null;
}

// ── Run ───────────────────────────────────────────────────────────────────────
runTask(scenario.task).catch(console.error);
