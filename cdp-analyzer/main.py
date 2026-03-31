"""
CDP Analyzer — Python service for DOM analysis.

Receives raw CDP snapshot data from the browser extension, processes it using
browser-use patterns (interactive detection, paint order filtering, shadow DOM
resolution), and returns a compact element list with coordinates.

The extension handles all CDP communication with Chrome — this service only
does the heavy data processing. No direct browser connection needed.
"""

import logging
import time
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cdp-analyzer")

app = FastAPI(title="CDP Analyzer", version="2.0.0")


# ── Models ──

class ProcessRequest(BaseModel):
    """Raw CDP data from the extension for processing."""
    snapshot: dict  # DOMSnapshot.captureSnapshot result
    ax_tree: dict  # Accessibility.getFullAXTree result
    url: str = ""
    title: str = ""


class Element(BaseModel):
    id: int
    role: str
    name: str
    tag: str = ""
    x: float = 0
    y: float = 0
    w: float = 0
    h: float = 0
    backend_node_id: int = 0
    attributes: dict[str, str] = {}
    states: list[str] = []
    depth: int = 0
    is_overflow_menu: bool = False


# ── Interactive Detection (browser-use patterns) ──

INTERACTIVE_TAGS = {
    "button", "input", "select", "textarea", "a", "details", "summary", "option",
}

INTERACTIVE_ROLES = {
    "button", "link", "menuitem", "option", "radio", "checkbox", "tab",
    "textbox", "combobox", "slider", "spinbutton", "search", "searchbox",
    "switch", "listbox", "menuitemcheckbox", "menuitemradio", "treeitem",
    "gridcell", "row", "cell",
}

INTERACTIVE_ATTRS = {"onclick", "onmousedown", "onkeydown", "onkeyup", "tabindex"}


SKIP_TAGS = {"svg", "path", "circle", "rect", "polygon", "line", "g", "slot",
             "faceplate-screen-reader-content", "style", "script", "noscript", "meta", "link", "head"}

def is_interactive(tag: str, attrs: dict, role: str = "", cursor: str = "") -> bool:
    """Multi-signal interactive element detection."""
    tag_lower = tag.lower()
    # Skip noise elements that should never be interactive
    if tag_lower in SKIP_TAGS:
        return False
    if tag_lower in INTERACTIVE_TAGS:
        return True
    if role.lower() in INTERACTIVE_ROLES:
        return True
    if any(a in attrs for a in INTERACTIVE_ATTRS):
        return True
    if attrs.get("contenteditable") in ("true", ""):
        return True
    if cursor == "pointer" and tag_lower not in ("div", "span", "li", "img"):
        return True  # only if not a generic container
    if attrs.get("role", "").lower() in INTERACTIVE_ROLES:
        return True
    # Elements with aria-label that are div/span — only if they also have role or tabindex
    if attrs.get("aria-label") and tag_lower in ("div", "span"):
        if attrs.get("role") or attrs.get("tabindex"):
            return True
    return False


def is_overflow_button(tag: str, attrs: dict, name: str) -> bool:
    """Detect three-dot / overflow / more-options buttons."""
    label = (attrs.get("aria-label", "") + " " + name).lower()
    text = name.strip()
    tag_lower = tag.lower()
    if tag_lower not in ("button",) and attrs.get("role") != "button":
        return False
    return (
        "more" in label or "option" in label or "overflow" in label or
        "user action" in label or "menu" in label or
        text in ("⋮", "⋯", "...", "…", "")
    )


def process_snapshot(snapshot: dict, ax_tree: dict) -> list[Element]:
    """
    Process raw CDP DOMSnapshot + AX tree data into interactive elements.
    Uses browser-use patterns: paint order, computed styles, shadow DOM depth.
    """
    start = time.time()

    # Build AX tree lookup: backendDOMNodeId → {role, name, properties}
    ax_lookup: dict[int, dict] = {}
    for node in ax_tree.get("nodes", []):
        bid = node.get("backendDOMNodeId")
        if not bid:
            continue
        role = node.get("role", {}).get("value", "")
        name = (node.get("name", {}).get("value", "") or "").strip()
        props = {}
        for p in node.get("properties", []):
            pname = p.get("name", "")
            pval = p.get("value", {}).get("value")
            if pname:
                props[pname] = pval
        ax_lookup[bid] = {
            "role": role,
            "name": name,
            "props": props,
            "ignored": node.get("ignored", False),
        }

    strings = snapshot.get("strings", [])

    def s(idx):
        """Resolve string index from snapshot string table."""
        if idx is None or not isinstance(idx, int) or idx < 0 or idx >= len(strings):
            return ""
        return strings[idx]

    elements: list[Element] = []
    elem_id = 1

    for doc_idx, snap_doc in enumerate(snapshot.get("documents", [])):
        nodes = snap_doc.get("nodes", {})
        node_names = nodes.get("nodeName", [])
        node_types = nodes.get("nodeType", [])
        backend_ids = nodes.get("backendNodeId", [])
        parent_indices = nodes.get("parentIndex", [])
        attributes_arr = nodes.get("attributes", [])

        layout = snap_doc.get("layout", {})
        layout_node_indices = layout.get("nodeIndex", [])
        layout_bounds = layout.get("bounds", [])
        layout_styles = layout.get("styles", [])
        paint_orders = layout.get("paintOrder", [])

        # Build layout lookup
        layout_lookup: dict[int, dict] = {}
        for i, node_idx in enumerate(layout_node_indices):
            bounds = layout_bounds[i] if i < len(layout_bounds) else [0, 0, 0, 0]
            styles = layout_styles[i] if i < len(layout_styles) else []
            po = paint_orders[i] if i < len(paint_orders) else 0
            layout_lookup[node_idx] = {"bounds": bounds, "styles": styles, "paintOrder": po}

        for node_idx in range(len(node_names)):
            node_type = node_types[node_idx] if node_idx < len(node_types) else 0
            if node_type != 1:  # ELEMENT_NODE only
                continue

            tag = s(node_names[node_idx]).lower() if node_idx < len(node_names) else ""
            bid = backend_ids[node_idx] if node_idx < len(backend_ids) else 0
            if not bid:
                continue

            # Layout info
            lay = layout_lookup.get(node_idx)
            if not lay:
                continue
            bounds = lay["bounds"]
            x, y, w, h = bounds[0], bounds[1], bounds[2], bounds[3]
            if w <= 0 or h <= 0:
                continue

            # Parse attributes
            attrs = {}
            raw_attrs = attributes_arr[node_idx] if node_idx < len(attributes_arr) else []
            for j in range(0, len(raw_attrs) - 1, 2):
                key = s(raw_attrs[j])
                val = s(raw_attrs[j + 1])
                if key:
                    attrs[key] = val

            # Computed styles
            style_values = lay.get("styles", [])
            cursor = ""
            display = ""
            visibility = ""
            opacity = ""
            for si, sv in enumerate(style_values):
                resolved = s(sv) if isinstance(sv, int) else str(sv)
                if si == 0: display = resolved
                elif si == 1: visibility = resolved
                elif si == 2: opacity = resolved
                elif si == 3: cursor = resolved

            # Skip invisible
            if display == "none" or visibility == "hidden" or opacity == "0":
                continue

            # Skip ad/promoted content entirely
            _all_attrs = " ".join(f"{k}={v}" for k, v in attrs.items()).lower()
            if any(ad in _all_attrs for ad in ("promoted", "sponsor", "adunit", "ad-slot", "ad_", "data-ad", "data-promoted")):
                continue

            # AX info
            ax = ax_lookup.get(bid, {})
            if ax.get("ignored"):
                continue
            role = ax.get("role", "")
            name = ax.get("name", "")
            ax_props = ax.get("props", {})

            # Check interactive
            if not is_interactive(tag, attrs, role, cursor):
                continue

            # Build label
            label = name
            if not label:
                label = (
                    attrs.get("aria-label", "") or
                    attrs.get("title", "") or
                    attrs.get("placeholder", "") or
                    attrs.get("alt", "") or
                    attrs.get("data-placeholder", "") or
                    tag
                )

            # States
            states = []
            if ax_props.get("focused"): states.append("focused")
            if ax_props.get("checked"): states.append("checked")
            if ax_props.get("expanded"): states.append("expanded")
            if ax_props.get("disabled"): states.append("disabled")
            if ax_props.get("pressed") is not None: states.append(f"pressed={ax_props['pressed']}")
            if ax_props.get("required"): states.append("required")
            if attrs.get("contenteditable") in ("true", ""): states.append("editable")

            # Shadow DOM depth
            depth = 0
            pi = parent_indices[node_idx] if node_idx < len(parent_indices) else -1
            while pi >= 0 and depth < 20:
                pname = s(node_names[pi]).lower() if pi < len(node_names) else ""
                if pname == "#document-fragment":
                    depth += 1
                pi = parent_indices[pi] if pi < len(parent_indices) else -1

            overflow = is_overflow_button(tag, attrs, label)

            # Limit attributes to useful ones
            useful_attrs = {}
            for k in ("href", "type", "placeholder", "contenteditable", "aria-label",
                       "role", "aria-expanded", "aria-haspopup", "data-placeholder"):
                if k in attrs:
                    useful_attrs[k] = attrs[k][:60]

            elements.append(Element(
                id=elem_id,
                role=role or tag,
                name=label[:80],
                tag=tag,
                x=round(x, 1), y=round(y, 1),
                w=round(w, 1), h=round(h, 1),
                backend_node_id=bid,
                attributes=useful_attrs,
                states=states,
                depth=depth,
                is_overflow_menu=overflow,
            ))
            elem_id += 1

    elapsed = round((time.time() - start) * 1000)
    logger.info(f"Processed snapshot: {len(elements)} interactive elements in {elapsed}ms")
    return elements


def extract_all_text_positions(snapshot: dict, ax_tree: dict) -> list[dict]:
    """Extract ALL visible text from the AX tree with positions from DOMSnapshot.

    The AX tree contains text for ALL elements including inside shadow DOM.
    DOMSnapshot provides coordinates. We merge them.
    """
    # Build coordinate lookup from DOMSnapshot: backendNodeId → bounds
    bounds_lookup: dict[int, list] = {}
    for doc_idx, snap_doc in enumerate(snapshot.get("documents", [])):
        nodes = snap_doc.get("nodes", {})
        backend_ids = nodes.get("backendNodeId", [])
        layout = snap_doc.get("layout", {})
        layout_node_indices = layout.get("nodeIndex", [])
        layout_bounds = layout.get("bounds", [])

        for i, ni in enumerate(layout_node_indices):
            if ni < len(backend_ids):
                bid = backend_ids[ni]
                if bid and i < len(layout_bounds):
                    b = layout_bounds[i]
                    if b[2] > 0 and b[3] > 0:  # width > 0, height > 0
                        bounds_lookup[bid] = b

    # Extract text from AX tree (captures shadow DOM text that DOMSnapshot text nodes miss)
    text_items = []
    for node in ax_tree.get("nodes", []):
        bid = node.get("backendDOMNodeId")
        if not bid:
            continue
        if node.get("ignored"):
            continue

        # Get name (visible text)
        name = (node.get("name", {}).get("value", "") or "").strip()
        if not name or len(name) < 3 or len(name) > 500:
            continue

        # Skip ad/promoted content text
        name_lower = name.lower()
        if any(ad in name_lower for ad in ("promoted", "sponsored", "advertisement", "about this ad", "tired of ads")):
            continue

        # Get role
        role = node.get("role", {}).get("value", "")
        # Include text from: staticText, paragraph, heading, listitem, and any named element
        # Skip generic roles that just repeat parent text
        if role in ("generic", "none", "presentation", "group", "list", "navigation", "banner",
                     "complementary", "contentinfo", "main", "region", "form"):
            # Only include if the text is short (specific content, not a large container)
            if len(name) > 100:
                continue

        # Get bounds
        bounds = bounds_lookup.get(bid)
        if not bounds:
            continue
        x, y, w, h = bounds[0], bounds[1], bounds[2], bounds[3]

        text_items.append({
            "text": name[:200],
            "x": round(x, 1), "y": round(y, 1),
            "w": round(w, 1), "h": round(h, 1),
            "backend_node_id": bid,
            "role": role,
        })

    # Deduplicate by text (keep first occurrence)
    seen = set()
    unique = []
    for item in text_items:
        key = item["text"][:50]
        if key not in seen:
            seen.add(key)
            unique.append(item)

    return unique


def elements_to_snapshot(elements: list[Element], url: str = "", title: str = "") -> str:
    """Convert elements to compact text snapshot for LLM."""
    lines = []
    if url: lines.append(f"PAGE: {url}")
    if title: lines.append(f"TITLE: {title}")
    lines.append(f"\nELEMENTS ({len(elements)}):")

    for el in elements:
        line = f"  [{el.id}] {el.role} \"{el.name}\""
        if el.depth > 0: line += f" [shadow:{el.depth}]"
        if el.states: line += f" [{', '.join(el.states)}]"
        if "href" in el.attributes: line += f" href={el.attributes['href'][:40]}"
        if "placeholder" in el.attributes: line += f" placeholder=\"{el.attributes['placeholder'][:30]}\""
        if "contenteditable" in el.attributes: line += " [EDITABLE]"
        if el.attributes.get("aria-haspopup") in ("true", "menu"): line += " [MENU-TRIGGER]"
        if el.is_overflow_menu: line += " [OVERFLOW-BTN]"
        lines.append(line)

    return "\n".join(lines)


def find_overflow_near_text(
    elements: list[Element], near_text: str,
    text_positions: list[dict] = None, ax_tree: dict = None
) -> Element | None:
    """Find the overflow button belonging to the comment containing near_text.

    Key insight: on social media, the comment layout is always:
        comment text → action bar (Reply, Share, Award, ⋯)

    So the comment's three-dot button is the FIRST overflow button
    that appears AFTER the comment text (in Y position).

    The post's three-dot button and ad buttons are always ABOVE the comment text.
    """
    overflow_btns = [el for el in elements if el.is_overflow_menu]
    if not overflow_btns:
        return None
    if not near_text:
        return overflow_btns[-1]

    # Find the Y position of the comment text
    text_y = 0
    text_bottom = 0

    # Search in text_positions first (includes non-interactive text like comment content)
    if text_positions:
        for t in text_positions:
            if near_text.lower() in t["text"].lower():
                text_y = t["y"]
                text_bottom = t["y"] + t["h"]
                break

    # Fallback: search interactive elements
    if text_y == 0:
        for el in elements:
            if near_text.lower() in el.name.lower():
                text_y = el.y
                text_bottom = el.y + el.h
                break

    if text_y == 0:
        # Can't find text at all — return last overflow button
        return overflow_btns[-1]

    # Find the FIRST overflow button that is BELOW the comment text.
    # "Below" means: button.y > text.y (button starts after text starts)
    # Within 200px — the action bar is immediately after the comment.
    # This SKIPS the post's overflow button (which is ABOVE the comment).
    below_btns = []
    for btn in overflow_btns:
        dy = btn.y - text_y
        # Button must be BELOW text start (dy > 0) and within reasonable range
        if dy > 0 and dy < 200:
            below_btns.append((dy, btn))

    if below_btns:
        # Sort by distance — closest one below is the comment's own button
        below_btns.sort(key=lambda x: x[0])
        return below_btns[0][1]

    # Wider search: 0 to 400px below
    wider_btns = [(btn.y - text_y, btn) for btn in overflow_btns if 0 < (btn.y - text_y) < 400]
    if wider_btns:
        wider_btns.sort(key=lambda x: x[0])
        return wider_btns[0][1]

    # Last resort: any button closest to text (but still prefer below)
    scored = []
    for btn in overflow_btns:
        dy = btn.y - text_y
        if dy >= 0:
            scored.append((dy, btn))  # below = good
        else:
            scored.append((abs(dy) * 10, btn))  # above = penalized 10x
    scored.sort(key=lambda x: x[0])
    return scored[0][1] if scored else overflow_btns[-1]


# ── API Endpoints ──

@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.0"}


@app.post("/process")
async def process(req: ProcessRequest):
    """Process raw CDP snapshot data and return interactive elements."""
    elements = process_snapshot(req.snapshot, req.ax_tree)
    text_positions = extract_all_text_positions(req.snapshot, req.ax_tree)

    # Build page text from AX tree — includes shadow DOM content
    # Filter for content-bearing roles (paragraphs, headings, text)
    content_roles = {"staticText", "paragraph", "heading", "listItem", "text", ""}
    content_texts = [t["text"] for t in text_positions if t.get("role", "") in content_roles or len(t["text"]) > 20]
    page_text = " ".join(content_texts)[:2000]

    snapshot_text = elements_to_snapshot(elements, req.url, req.title)
    if page_text:
        # Insert page text after TITLE line
        lines = snapshot_text.split("\n")
        insert_idx = 2 if len(lines) > 2 else len(lines)
        lines.insert(insert_idx, f"TEXT: {page_text}")
        snapshot_text = "\n".join(lines)

    return {
        "snapshot": snapshot_text,
        "elements": [el.model_dump() for el in elements],
        "text_elements": text_positions[:50],  # Top 50 text elements for reference
        "count": len(elements),
    }


@app.post("/find-overflow")
async def find_overflow(req: ProcessRequest, near_text: str = "", menu_action: str = ""):
    """Process snapshot and find overflow menu button + menu item."""
    elements = process_snapshot(req.snapshot, req.ax_tree)
    text_positions = extract_all_text_positions(req.snapshot, req.ax_tree)
    btn = find_overflow_near_text(elements, near_text, text_positions, req.ax_tree)
    if not btn:
        return {"ok": False, "error": "No overflow button found", "elements_count": len(elements)}

    # Also look for menu items (in case menu is already open)
    menu_items = []
    if menu_action:
        menu_items = [
            {"id": el.id, "name": el.name, "x": el.x + el.w / 2, "y": el.y + el.h / 2, "backend_node_id": el.backend_node_id}
            for el in elements
            if menu_action.lower() in el.name.lower() and el.h < 60
        ]

    return {
        "ok": True,
        "button": {
            "id": btn.id,
            "name": btn.name,
            "x": btn.x + btn.w / 2,
            "y": btn.y + btn.h / 2,
            "backend_node_id": btn.backend_node_id,
            "aria_label": btn.attributes.get("aria-label", ""),
        },
        "menu_items": menu_items,
        "elements_count": len(elements),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5050)
