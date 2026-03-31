/**
 * human-mouse.js — Human-like mouse movement via CDP
 *
 * Generates realistic mouse movement paths using cubic bezier curves
 * with randomized control points, variable speed, and micro-jitter.
 *
 * Key principles:
 * 1. Real humans don't move in straight lines — they curve
 * 2. Real humans overshoot slightly, then correct
 * 3. Movement speed varies — fast in the middle, slow at start/end
 * 4. Clicks don't land on exact center — random offset ±3px
 * 5. There's always a hover dwell time before clicking (50-200ms)
 */

/* ── Random helpers ── */
function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

/**
 * Generate a cubic bezier curve point at parameter t (0-1).
 * P0 = start, P1 = control1, P2 = control2, P3 = end
 */
function bezierPoint(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/**
 * Generate a human-like mouse path from (x0,y0) to (x1,y1).
 *
 * Returns array of {x, y, delay} points representing intermediate mouse positions.
 * delay = milliseconds to wait before dispatching this point's mouseMoved event.
 *
 * @param {number} x0 - Start X
 * @param {number} y0 - Start Y
 * @param {number} x1 - End X
 * @param {number} y1 - End Y
 * @param {object} opts - Options
 * @param {number} opts.steps - Number of intermediate points (default: auto based on distance)
 * @param {number} opts.overshoot - Overshoot factor 0-1 (default: 0.02-0.08 random)
 * @param {boolean} opts.jitter - Add micro-jitter to each point (default: true)
 */
function generateMousePath(x0, y0, x1, y1, opts = {}) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Very short distances — just a few points
  if (distance < 10) {
    return [
      { x: x0, y: y0, delay: 0 },
      { x: x1, y: y1, delay: randInt(8, 20) },
    ];
  }

  // Auto-calculate steps based on distance (more distance = more points)
  // Humans move at roughly 400-800px/s, at 60fps = 6-13px per frame
  // We want 1 event per ~8-15ms for realism
  const steps = opts.steps || Math.max(8, Math.min(35, Math.round(distance / rand(12, 20))));

  // Control points for bezier curve — offset perpendicular to the direct path
  // This creates the natural arc humans make when moving the mouse
  const perpX = -dy / distance; // perpendicular unit vector
  const perpY = dx / distance;
  const curvature = rand(0.1, 0.35) * distance; // how much the path curves
  const curveDir = Math.random() > 0.5 ? 1 : -1; // curve left or right randomly

  // Control point 1: ~30% along path, offset perpendicular
  const cp1x = x0 + dx * 0.3 + perpX * curvature * curveDir * rand(0.3, 0.7);
  const cp1y = y0 + dy * 0.3 + perpY * curvature * curveDir * rand(0.3, 0.7);

  // Control point 2: ~70% along path, offset less (path straightens toward target)
  const cp2x = x0 + dx * 0.7 + perpX * curvature * curveDir * rand(0.0, 0.3);
  const cp2y = y0 + dy * 0.7 + perpY * curvature * curveDir * rand(0.0, 0.3);

  const points = [];
  const jitter = opts.jitter !== false;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;

    // Easing: slow-fast-slow (approximates human acceleration/deceleration)
    // Using smoothstep: 3t^2 - 2t^3
    const eased = t * t * (3 - 2 * t);

    let x = bezierPoint(eased, x0, cp1x, cp2x, x1);
    let y = bezierPoint(eased, y0, cp1y, cp2y, y1);

    // Add micro-jitter (±1-2px) — humans can't hold perfectly steady
    if (jitter && i > 0 && i < steps) {
      x += rand(-1.5, 1.5);
      y += rand(-1.5, 1.5);
    }

    // Variable delay: slower at start and end, faster in middle
    // This mimics human acceleration patterns
    let delay;
    if (i === 0) {
      delay = 0;
    } else {
      const speedFactor = 1 - 0.5 * Math.sin(Math.PI * t); // 0.5-1.0, slowest at edges
      delay = randInt(6, 14) * speedFactor;
    }

    points.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, delay: Math.round(delay) });
  }

  // Optional: slight overshoot + correction (happens ~40% of the time for longer moves)
  const overshoot = opts.overshoot ?? (distance > 100 && Math.random() > 0.6 ? rand(0.02, 0.06) : 0);
  if (overshoot > 0) {
    const ovX = x1 + dx * overshoot + rand(-2, 2);
    const ovY = y1 + dy * overshoot + rand(-2, 2);
    // Add overshoot point
    points.push({ x: Math.round(ovX * 10) / 10, y: Math.round(ovY * 10) / 10, delay: randInt(8, 15) });
    // Correction back to target
    points.push({ x: x1 + rand(-1, 1), y: y1 + rand(-1, 1), delay: randInt(20, 40) });
  }

  return points;
}

/**
 * Add random offset to click coordinates (don't click exact center).
 * Humans click within a ~6px radius of center, biased toward center.
 */
function jitterClick(x, y, radius = 3) {
  const angle = Math.random() * Math.PI * 2;
  const r = Math.random() * radius * Math.random(); // double random = bias toward center
  return {
    x: Math.round((x + Math.cos(angle) * r) * 10) / 10,
    y: Math.round((y + Math.sin(angle) * r) * 10) / 10,
  };
}

/**
 * Execute a human-like mouse movement via CDP Input.dispatchMouseEvent.
 *
 * @param {function} cdpSend - function(tabId, method, params) that sends CDP commands
 * @param {number} tabId - Chrome tab ID
 * @param {number} fromX - Current mouse X (0,0 if unknown)
 * @param {number} fromY - Current mouse Y (0,0 if unknown)
 * @param {number} toX - Target X
 * @param {number} toY - Target Y
 */
async function humanMouseMove(cdpSend, tabId, fromX, fromY, toX, toY) {
  const path = generateMousePath(fromX, fromY, toX, toY);

  for (const point of path) {
    if (point.delay > 0) {
      await new Promise(r => setTimeout(r, point.delay));
    }
    await cdpSend(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
      button: 'none',
    });
  }
}

/**
 * Execute a full human-like click sequence:
 * 1. Move mouse along bezier curve to target
 * 2. Hover dwell (50-200ms) — triggers mouseenter/mouseover
 * 3. Click with jittered coordinates
 *
 * @param {function} cdpSend - CDP send function
 * @param {number} tabId - Chrome tab ID
 * @param {number} toX - Target center X
 * @param {number} toY - Target center Y
 * @param {number} fromX - Current mouse X (pass last known position)
 * @param {number} fromY - Current mouse Y
 * @returns {{ clickX: number, clickY: number }} - actual click coordinates
 */
async function humanClick(cdpSend, tabId, toX, toY, fromX = 0, fromY = 0) {
  // 1. Move mouse along realistic path
  await humanMouseMove(cdpSend, tabId, fromX, fromY, toX, toY);

  // 2. Hover dwell — real humans pause before clicking (50-180ms)
  await new Promise(r => setTimeout(r, randInt(50, 180)));

  // 3. Click with jittered position (not exact center)
  const { x: clickX, y: clickY } = jitterClick(toX, toY);

  // mousePressed with realistic timing
  await cdpSend(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: clickX,
    y: clickY,
    button: 'left',
    clickCount: 1,
    modifiers: 0,
  });

  // Small delay between press and release (humans hold for 50-120ms)
  await new Promise(r => setTimeout(r, randInt(50, 120)));

  await cdpSend(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: clickX,
    y: clickY,
    button: 'left',
    clickCount: 1,
    modifiers: 0,
  });

  return { clickX, clickY };
}

/**
 * Human-like hover (no click) — move to element and stay.
 * Triggers mouseenter, mouseover, mousemove events naturally.
 */
async function humanHover(cdpSend, tabId, toX, toY, fromX = 0, fromY = 0) {
  await humanMouseMove(cdpSend, tabId, fromX, fromY, toX, toY);
  // Small dwell to ensure hover state registers
  await new Promise(r => setTimeout(r, randInt(100, 300)));
}

/**
 * Human-like double click.
 */
async function humanDoubleClick(cdpSend, tabId, toX, toY, fromX = 0, fromY = 0) {
  await humanMouseMove(cdpSend, tabId, fromX, fromY, toX, toY);
  await new Promise(r => setTimeout(r, randInt(50, 150)));

  const { x: cx, y: cy } = jitterClick(toX, toY, 2);

  // First click
  await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
  await new Promise(r => setTimeout(r, randInt(40, 80)));
  await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 });

  // Inter-click delay (80-160ms typical for double click)
  await new Promise(r => setTimeout(r, randInt(80, 160)));

  // Second click
  await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 2 });
  await new Promise(r => setTimeout(r, randInt(40, 80)));
  await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 2 });

  return { clickX: cx, clickY: cy };
}
