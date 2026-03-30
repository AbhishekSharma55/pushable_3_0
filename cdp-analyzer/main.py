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
    """Extract ALL visible text elements with their positions (not just interactive).
    Used for finding content like comments, usernames, etc."""
    strings = snapshot.get("strings", [])
    def s(idx):
        if idx is None or not isinstance(idx, int) or idx < 0 or idx >= len(strings):
            return ""
        return strings[idx]

    # Build AX name lookup for text
    ax_names: dict[int, str] = {}
    for node in ax_tree.get("nodes", []):
        bid = node.get("backendDOMNodeId")
        name = (node.get("name", {}).get("value", "") or "").strip()
        if bid and name:
            ax_names[bid] = name

    text_items = []
    for doc_idx, snap_doc in enumerate(snapshot.get("documents", [])):
        nodes = snap_doc.get("nodes", {})
        node_names = nodes.get("nodeName", [])
        node_types = nodes.get("nodeType", [])
        backend_ids = nodes.get("backendNodeId", [])
        node_values = nodes.get("nodeValue", [])
        layout = snap_doc.get("layout", {})
        layout_node_indices = layout.get("nodeIndex", [])
        layout_bounds = layout.get("bounds", [])
        layout_styles = layout.get("styles", [])

        layout_lookup: dict[int, list] = {}
        for i, ni in enumerate(layout_node_indices):
            layout_lookup[ni] = layout_bounds[i] if i < len(layout_bounds) else [0,0,0,0]

        for node_idx in range(len(node_names)):
            # Include both element nodes and text nodes
            ntype = node_types[node_idx] if node_idx < len(node_types) else 0
            bid = backend_ids[node_idx] if node_idx < len(backend_ids) else 0
            bounds = layout_lookup.get(node_idx)
            if not bounds:
                continue
            x, y, w, h = bounds[0], bounds[1], bounds[2], bounds[3]
            if w <= 0 or h <= 0:
                continue

            # Get text from AX tree or node value
            text = ax_names.get(bid, "")
            if not text and ntype == 3:  # TEXT_NODE
                val_idx = node_values[node_idx] if node_idx < len(node_values) else -1
                text = s(val_idx).strip()
            if not text:
                continue
            if len(text) < 3 or len(text) > 500:
                continue

            text_items.append({
                "text": text[:200],
                "x": round(x, 1), "y": round(y, 1),
                "w": round(w, 1), "h": round(h, 1),
                "backend_node_id": bid,
            })

    return text_items


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


def find_overflow_near_text(elements: list[Element], near_text: str, text_positions: list[dict] = None) -> Element | None:
    """Find the overflow button closest to the specified text.

    Key insight: on Reddit/social media, the comment's three-dot button is
    BELOW the comment text (in the action bar with Reply/Share).
    Ad three-dot buttons are ABOVE. So we STRONGLY prefer buttons below the text.
    """
    overflow_btns = [el for el in elements if el.is_overflow_menu]
    if not overflow_btns:
        return None

    if not near_text:
        return overflow_btns[-1]

    # Search in interactive elements first
    text_els = [el for el in elements if near_text.lower() in el.name.lower()]

    # If not found, search ALL text positions
    if not text_els and text_positions:
        matching_texts = [t for t in text_positions if near_text.lower() in t["text"].lower()]
        if matching_texts:
            t = matching_texts[0]
            text_els = [Element(id=0, role="text", name=t["text"], x=t["x"], y=t["y"], w=t["w"], h=t["h"])]

    if not text_els:
        return overflow_btns[-1]

    text_el = text_els[0]

    # Filter out buttons that are clearly from ads/promoted content
    non_ad_btns = []
    for btn in overflow_btns:
        # Skip buttons whose aria-label or nearby context suggests ad/promoted
        label = (btn.attributes.get("aria-label", "") + " " + btn.name).lower()
        if "ad" in label.split() or "promoted" in label or "sponsor" in label:
            continue
        non_ad_btns.append(btn)

    candidates = non_ad_btns if non_ad_btns else overflow_btns

    best = None
    best_score = float("inf")
    for btn in candidates:
        dy = btn.y - text_el.y  # positive = button is BELOW text
        dx = abs(btn.x - text_el.x)

        # Score: lower is better
        if dy >= 0 and dy < 300:
            # Button is BELOW text and within 300px — BEST (comment action bar)
            score = dy + dx * 0.5
        elif dy >= 0:
            # Button is far below — less likely to be related
            score = dy * 2 + dx
        else:
            # Button is ABOVE text — PENALIZE heavily (likely ad or post button)
            score = abs(dy) * 5 + dx * 2 + 1000

        if score < best_score:
            best_score = score
            best = btn

    return best


# ── API Endpoints ──

@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.0"}


@app.post("/process")
async def process(req: ProcessRequest):
    """Process raw CDP snapshot data and return interactive elements."""
    elements = process_snapshot(req.snapshot, req.ax_tree)
    text_positions = extract_all_text_positions(req.snapshot, req.ax_tree)

    # Build page text summary from visible text (first 2000 chars)
    all_text = " ".join(t["text"] for t in text_positions[:100])
    page_text = all_text[:2000] if all_text else ""

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
    btn = find_overflow_near_text(elements, near_text, text_positions)
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
