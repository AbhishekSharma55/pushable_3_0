"""
DOM extraction and element indexing for AI browser automation.

Extracts interactive elements from the page, assigns index numbers,
and stores references for index-based interaction (click, type).
Inspired by Browser Use's element tree approach but optimized for
Playwright + Camoufox.
"""

# JavaScript injected into the page to extract interactive elements
# and store references for index-based interaction.
EXTRACT_ELEMENTS_JS = """
(() => {
  // Store element references for index-based interaction
  window.__elements = new Map();

  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;
    return true;
  };

  const isNearViewport = (el) => {
    const rect = el.getBoundingClientRect();
    const buffer = 500;
    return rect.bottom >= -buffer && rect.top <= window.innerHeight + buffer;
  };

  const getDirectText = (el) => {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === 3) { // TEXT_NODE
        const t = node.textContent.trim();
        if (t) text += (text ? ' ' : '') + t;
      }
    }
    if (!text) {
      text = el.textContent?.trim() || '';
    }
    return text.replace(/\\s+/g, ' ').slice(0, 80);
  };

  // Interactive element selectors
  const selectors = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="textbox"]',
    '[role="combobox"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="switch"]',
    '[role="option"]',
    '[role="searchbox"]',
    '[onclick]',
    '[contenteditable="true"]',
    'summary',
    'details > summary',
    'dialog[open]',
    '[role="dialog"]',
    '[role="alertdialog"]',
  ];

  // Also traverse shadow DOM roots
  const allInteractive = [];
  const collectElements = (root) => {
    try {
      const found = root.querySelectorAll(selectors.join(','));
      for (const el of found) allInteractive.push(el);
      // Check for shadow roots
      const allEls = root.querySelectorAll('*');
      for (const el of allEls) {
        if (el.shadowRoot) {
          collectElements(el.shadowRoot);
        }
      }
    } catch(e) {}
  };
  collectElements(document);

  const elements = [];
  let index = 0;

  // Detect overlaying modal/dialog
  const openDialog = document.querySelector('dialog[open]');
  const roleDialog = document.querySelector('[role="dialog"], [role="alertdialog"]');
  const hasOverlay = !!(openDialog || roleDialog);

  // If there's a dialog/modal, prioritize its elements
  const overlayRoot = openDialog || roleDialog;

  for (const el of allInteractive) {
    if (!isVisible(el)) continue;

    const tag = el.tagName.toLowerCase();
    const text = getDirectText(el);
    const ariaLabel = el.getAttribute('aria-label') || '';
    const placeholder = el.getAttribute('placeholder') || '';
    const type = el.getAttribute('type') || '';
    const href = tag === 'a' ? (el.getAttribute('href') || '').slice(0, 120) : '';
    const name = el.getAttribute('name') || '';
    const role = el.getAttribute('role') || '';
    const title = el.getAttribute('title') || '';
    const disabled = el.hasAttribute('disabled');
    const inViewport = isNearViewport(el);

    // Get current value for form elements
    let value = '';
    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox' || el.type === 'radio') {
        value = el.checked ? 'checked' : 'unchecked';
      } else {
        value = el.value?.slice(0, 60) || '';
      }
    } else if (el instanceof HTMLSelectElement) {
      value = el.options[el.selectedIndex]?.text?.slice(0, 60) || el.value || '';
    } else if (el instanceof HTMLTextAreaElement) {
      value = el.value?.slice(0, 60) || '';
    }

    // Check if element is inside the overlay dialog
    const inDialog = overlayRoot ? overlayRoot.contains(el) : false;
    const isDialogEl = tag === 'dialog' || role === 'dialog' || role === 'alertdialog';

    // Build description line
    let desc = '[' + index + '] <' + tag;
    if (type && type !== 'submit' && type !== 'button') desc += ' type="' + type + '"';
    if (role && role !== tag) desc += ' role="' + role + '"';
    if (name) desc += ' name="' + name + '"';
    if (href) desc += ' href="' + href + '"';
    if (placeholder) desc += ' placeholder="' + placeholder + '"';
    if (disabled) desc += ' disabled';
    desc += '>';

    // Add readable label
    const label = ariaLabel || title || text;
    if (label) desc += ' "' + label + '"';

    // Add value for form elements
    if (value && !isDialogEl) {
      if (type === 'checkbox' || type === 'radio') {
        desc += ' [' + value + ']';
      } else {
        desc += ' value="' + value + '"';
      }
    }

    // Contextual markers
    if (isDialogEl) desc += ' [DIALOG/MODAL]';
    else if (inDialog) desc += ' [IN DIALOG]';
    if (!inViewport) desc += ' [BELOW FOLD]';

    // Store reference
    window.__elements.set(index, el);

    elements.push(desc);
    index++;
  }

  // Extract headings for page context
  const headings = [];
  for (const h of document.querySelectorAll('h1, h2, h3')) {
    const t = h.textContent?.trim().replace(/\\s+/g, ' ').slice(0, 80);
    if (t) headings.push(h.tagName.toLowerCase() + ': ' + t);
    if (headings.length >= 5) break;
  }

  // Scroll / page info
  const scrollY = window.scrollY;
  const scrollHeight = document.documentElement.scrollHeight;
  const viewportHeight = window.innerHeight;
  const pagesAbove = Math.round((scrollY / viewportHeight) * 10) / 10;
  const pagesBelow = Math.round(((scrollHeight - scrollY - viewportHeight) / viewportHeight) * 10) / 10;

  return {
    url: window.location.href,
    title: document.title,
    headings: headings,
    elements: elements,
    elementCount: elements.length,
    hasOverlay: hasOverlay,
    scroll: {
      pagesAbove: pagesAbove,
      pagesBelow: Math.max(0, pagesBelow),
    },
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
})()
"""

# JavaScript to scroll element into view and return its center coordinates
CLICK_ELEMENT_JS = """
(index) => {
  const el = window.__elements?.get(index);
  if (!el) return { error: 'Element with index ' + index + ' not found. The page may have changed — call get_interactive_elements to refresh.' };
  if (!el.isConnected) return { error: 'Element ' + index + ' is no longer in the DOM. Call get_interactive_elements to refresh.' };
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  const rect = el.getBoundingClientRect();
  return {
    x: Math.round(rect.x + rect.width / 2),
    y: Math.round(rect.y + rect.height / 2),
    tag: el.tagName.toLowerCase(),
    text: (el.textContent || '').trim().slice(0, 60),
  };
}
"""

# JavaScript to focus element for typing
FOCUS_ELEMENT_JS = """
(args) => {
  const el = window.__elements?.get(args.index);
  if (!el) return { error: 'Element with index ' + args.index + ' not found. Call get_interactive_elements to refresh.' };
  if (!el.isConnected) return { error: 'Element ' + args.index + ' is no longer in the DOM. Call get_interactive_elements to refresh.' };
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  el.focus();
  if (args.clearFirst) {
    if (el.select) el.select();
  }
  return {
    focused: true,
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute('type') || '',
    currentValue: el.value || '',
  };
}
"""


def serialize_page_state(data: dict, dismissed_dialogs: list[dict] | None = None) -> str:
    """Format extracted page state as concise text for the LLM."""
    lines = []

    # Page identity
    lines.append(f"Page: {data['title']}")
    lines.append(f"URL: {data['url']}")

    # Scroll position
    above = data["scroll"]["pagesAbove"]
    below = data["scroll"]["pagesBelow"]
    if above > 0 or below > 0:
        parts = []
        if above > 0:
            parts.append(f"{above} pages above")
        if below > 0:
            parts.append(f"{below} pages below")
        lines.append(f"Scroll: {', '.join(parts)}")

    # Headings for context
    if data.get("headings"):
        lines.append("")
        lines.append("Page headings:")
        for h in data["headings"]:
            lines.append(f"  {h}")

    # Auto-dismissed dialogs
    if dismissed_dialogs:
        lines.append("")
        lines.append("Auto-dismissed dialogs:")
        for d in dismissed_dialogs:
            lines.append(f'  [{d["type"]}] "{d["message"]}"')

    # Overlay warning
    if data.get("hasOverlay"):
        lines.append("")
        lines.append("⚠ A dialog/modal is open. Interact with [IN DIALOG] elements first, or close it.")

    # Interactive elements
    lines.append("")
    if data["elementCount"] > 0:
        lines.append(f"Interactive elements ({data['elementCount']}):")
        for desc in data["elements"]:
            lines.append(f"  {desc}")
    else:
        lines.append("No interactive elements found on this page.")

    return "\n".join(lines)
