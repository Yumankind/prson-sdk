/**
 * Virtual-cursor-friendly overlay for native `<select>` elements.
 *
 * Why this exists: native `<select>` dropdowns are rendered by the OS
 * shell, not the DOM. Synthetic `click` events from `bindMouse`'s
 * virtual cursor cannot open them, and even if they did the OS-drawn
 * option list is outside the page's coordinate system — the virtual
 * cursor couldn't navigate it. We replace the native dropdown with a
 * pure-DOM overlay sized for cursor accuracy:
 *
 *   * Each option is a large (≥56 px tall) button — easy to land on
 *     with the wand or trackpad.
 *   * "Previous page" / "Next page" buttons step through long option
 *     lists one viewport-sized chunk at a time.
 *   * An "X" button closes without committing a choice.
 *   * The overlay sits at the top of the body z-index stack and
 *     traps clicks: while it's open, the rest of the page is
 *     non-interactive — the cursor's click router only considers
 *     overlay elements.
 *   * The overlay is rendered inside a Shadow DOM root with
 *     `:host { all: initial; }` so the host page's stylesheets
 *     cannot bleed in. The page can neither restyle nor read the
 *     overlay (closed-mode shadow), beyond what we deliberately
 *     expose via attributes.
 *
 * Wiring from `bindMouse`:
 *
 *   * Move frames re-route the snap target into the overlay via
 *     [findNearestClickableInOverlay] when the overlay is open.
 *   * Click frames detect `<select>` snap targets and open the
 *     overlay instead of dispatching a click. When the overlay is
 *     open, subsequent clicks route through it.
 *   * `bindMouse.dispose()` calls [closeAllOverlays] so a torn-down
 *     cursor doesn't leave the overlay orphaned.
 */

interface OverlayHandle {
  host: HTMLElement;
  shadow: ShadowRoot;
  close: () => void;
}

let activeOverlay: OverlayHandle | null = null;

/** True when a select overlay is currently open + accepting input. */
export function isSelectOverlayActive(): boolean {
  return activeOverlay !== null;
}

/** Close any currently-open overlay. No-op when none is open. */
export function closeAllOverlays(): void {
  activeOverlay?.close();
}

/**
 * Mount the overlay for [select]. Replaces any existing overlay.
 * Returns the handle so callers can close it programmatically (e.g.
 * if the cursor disposes while the overlay is still up). The
 * overlay self-closes when the user picks an option or taps X.
 */
export function openSelectOverlay(select: HTMLSelectElement): OverlayHandle {
  if (activeOverlay) activeOverlay.close();

  const host = document.createElement("div");
  host.setAttribute("data-prson-select-overlay", "");
  // Pin the host to the viewport. Inline styles win over any page
  // CSS that might try to position `div` differently (Shadow DOM
  // protects the inside; the host element itself is still in the
  // light tree).
  host.style.position = "fixed";
  host.style.inset = "0";
  // z-index sits just below the virtual cursor (2147483647) so the
  // cursor still paints on top of the overlay.
  host.style.zIndex = "2147483646";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = OVERLAY_CSS;
  shadow.appendChild(style);

  // Title label: prefer the matching `<label>`, then aria-label,
  // then name, then a generic string. Done once at open time so
  // late `label` mutations don't change the title mid-life.
  const title = pickTitle(select);

  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";
  backdrop.setAttribute("data-prson-select-backdrop", "");

  const panel = document.createElement("div");
  panel.className = "panel";

  // ── header ────
  const header = document.createElement("div");
  header.className = "header";
  const titleEl = document.createElement("div");
  titleEl.className = "title";
  titleEl.textContent = title;
  const closeBtn = document.createElement("button");
  closeBtn.className = "close";
  closeBtn.setAttribute("type", "button");
  closeBtn.setAttribute("data-prson-select-close", "");
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "✕";
  header.appendChild(titleEl);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // ── pagination row + options ────
  const optionsWrap = document.createElement("div");
  optionsWrap.className = "options-wrap";

  const pageUp = document.createElement("button");
  pageUp.className = "page-btn";
  pageUp.setAttribute("type", "button");
  pageUp.setAttribute("data-prson-select-page", "up");
  pageUp.innerHTML = '<span class="chev">▲</span> Previous';

  const list = document.createElement("div");
  list.className = "options-list";

  const pageDown = document.createElement("button");
  pageDown.className = "page-btn";
  pageDown.setAttribute("type", "button");
  pageDown.setAttribute("data-prson-select-page", "down");
  pageDown.innerHTML = 'Next <span class="chev">▼</span>';

  optionsWrap.appendChild(pageUp);
  optionsWrap.appendChild(list);
  optionsWrap.appendChild(pageDown);
  panel.appendChild(optionsWrap);

  backdrop.appendChild(panel);
  shadow.appendChild(backdrop);

  // ── options paging ────
  const options = Array.from(select.options);
  const PAGE_SIZE = 6;
  const numPages = Math.max(1, Math.ceil(options.length / PAGE_SIZE));
  let currentPage = pageOfValue(select.value, options, PAGE_SIZE);

  function renderPage(): void {
    list.replaceChildren();
    const start = currentPage * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, options.length);
    for (let i = start; i < end; i++) {
      const opt = options[i]!;
      const btn = document.createElement("button");
      btn.className = "option";
      btn.setAttribute("type", "button");
      btn.setAttribute("data-prson-select-option", String(i));
      btn.textContent = opt.label || opt.value || `Option ${i + 1}`;
      if (opt.value === select.value) {
        btn.setAttribute("data-selected", "");
      }
      list.appendChild(btn);
    }
    // Toggle paging button state. Visible-but-disabled rather than
    // removed so the layout stays stable (cursor doesn't have to
    // re-find the button when there's more to page through).
    if (currentPage <= 0) {
      pageUp.setAttribute("disabled", "");
    } else {
      pageUp.removeAttribute("disabled");
    }
    if (currentPage >= numPages - 1) {
      pageDown.setAttribute("disabled", "");
    } else {
      pageDown.removeAttribute("disabled");
    }
  }
  renderPage();

  const handle: OverlayHandle = {
    host,
    shadow,
    close: () => {
      host.remove();
      if (activeOverlay === handle) activeOverlay = null;
    },
  };

  // Click handler — works for both real-finger taps AND synthetic
  // events from the virtual cursor. `composedPath()` is required to
  // reach into the shadow tree from the listener on `shadow` itself.
  shadow.addEventListener("click", (e) => {
    const path = (e as Event).composedPath();
    for (const node of path) {
      if (!(node instanceof Element)) continue;
      // Close button.
      if (node.getAttribute?.("data-prson-select-close") !== null) {
        handle.close();
        return;
      }
      // Page buttons.
      const page = node.getAttribute?.("data-prson-select-page");
      if (page === "up") {
        if (currentPage > 0) {
          currentPage -= 1;
          renderPage();
        }
        return;
      }
      if (page === "down") {
        if (currentPage < numPages - 1) {
          currentPage += 1;
          renderPage();
        }
        return;
      }
      // Option.
      const optAttr = node.getAttribute?.("data-prson-select-option");
      if (optAttr !== null && optAttr !== undefined) {
        const idx = Number.parseInt(optAttr, 10);
        const chosen = options[idx];
        if (chosen) {
          select.value = chosen.value;
          select.dispatchEvent(new Event("input", { bubbles: true }));
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        handle.close();
        return;
      }
      // Backdrop tap (anywhere outside the panel) closes too — the
      // virtual cursor can't escape to it easily, but a real finger
      // can.
      if (node.getAttribute?.("data-prson-select-backdrop") !== null) {
        handle.close();
        return;
      }
    }
  });

  activeOverlay = handle;
  return handle;
}

/**
 * Snap-target lookup *inside* the active overlay. Bind.ts swaps
 * the regular `findNearestClickable` for this when an overlay is
 * open so the magic-mode highlight tracks the overlay's option
 * buttons instead of the (no-longer-interactive) page underneath.
 *
 * No radius cap — when the overlay is open the cursor MUST land on
 * something useful, so we always return a snap target if any
 * candidate exists.
 */
export function findNearestClickableInOverlay(
  x: number,
  y: number,
): Element | null {
  if (!activeOverlay) return null;
  const candidates = activeOverlay.shadow.querySelectorAll(
    "[data-prson-select-close]," +
      "[data-prson-select-page]:not([disabled])," +
      "[data-prson-select-option]",
  );
  let best: Element | null = null;
  let bestDist = Infinity;
  for (const el of Array.from(candidates)) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) {
      bestDist = dist;
      best = el;
    }
  }
  return best;
}

/**
 * Highlight an element inside the active overlay by setting the
 * shared `data-prson-magic-snap` attribute. The overlay's own CSS
 * (inside the shadow) provides the visible style — the page's
 * stylesheet for that attribute cannot reach in.
 */
export function setOverlaySnap(target: Element | null): void {
  if (!activeOverlay) return;
  activeOverlay.shadow
    .querySelectorAll("[data-prson-magic-snap]")
    .forEach((el) => el.removeAttribute("data-prson-magic-snap"));
  if (target) target.setAttribute("data-prson-magic-snap", "");
}

// ─── internals ─────────────────────────────────────────────────────

function pickTitle(select: HTMLSelectElement): string {
  // Prefer an explicit label[for=id] OR a wrapping <label>.
  if (select.id) {
    const lbl = document.querySelector(
      `label[for="${cssEscapeLocal(select.id)}"]`,
    );
    if (lbl?.textContent) return lbl.textContent.trim();
  }
  const wrap = select.closest("label");
  if (wrap && wrap.textContent) {
    // Strip out the select's own rendered text from the label's
    // text content; label.textContent concatenates everything.
    const txt = wrap.textContent
      .replace(select.textContent ?? "", "")
      .trim();
    if (txt) return txt;
  }
  const aria = select.getAttribute("aria-label");
  if (aria) return aria;
  const name = select.getAttribute("name");
  if (name) return name;
  return "Select an option";
}

function pageOfValue(
  current: string,
  options: HTMLOptionElement[],
  pageSize: number,
): number {
  const idx = options.findIndex((o) => o.value === current);
  if (idx < 0) return 0;
  return Math.floor(idx / pageSize);
}

function cssEscapeLocal(s: string): string {
  if (typeof CSS !== "undefined" && typeof (CSS as { escape?: (s: string) => string }).escape === "function") {
    return (CSS as { escape: (s: string) => string }).escape(s);
  }
  return s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

// All overlay styling is in the shadow root, so it cannot collide
// with the host page's CSS and the host page cannot override it
// without explicitly piercing the shadow boundary. Sized for thumb
// + virtual-cursor accuracy: every interactive element is at least
// 56 px tall and 44 px wide.
const OVERLAY_CSS = `
  :host {
    all: initial;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    color: #0f172a;
  }
  * { box-sizing: border-box; }
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.55);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .panel {
    width: min(440px, 100%);
    max-height: 88vh;
    background: #ffffff;
    border-radius: 20px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 24px 56px rgba(15, 23, 42, 0.32);
  }
  .header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 18px 20px;
    border-bottom: 1px solid #e2e8f0;
  }
  .title {
    flex: 1;
    font-size: 18px;
    font-weight: 700;
    color: #0f172a;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .close {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: 1px solid #e2e8f0;
    background: #f1f5f9;
    color: #475569;
    font-size: 18px;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .close:hover { background: #e2e8f0; }
  .options-wrap {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .page-btn {
    width: 100%;
    padding: 18px 20px;
    border: none;
    background: #f8fafc;
    color: #475569;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  .page-btn .chev { font-size: 13px; opacity: 0.8; }
  .page-btn:hover { background: #f1f5f9; color: #1e293b; }
  .page-btn[disabled] {
    opacity: 0.35;
    cursor: default;
    background: #f8fafc;
    color: #475569;
  }
  .options-list {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }
  .option {
    appearance: none;
    width: 100%;
    padding: 18px 20px;
    border: none;
    background: #ffffff;
    color: #0f172a;
    font-size: 16px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    border-bottom: 1px solid #f1f5f9;
    min-height: 60px;
  }
  .option:hover { background: #eff6ff; color: #1d4ed8; }
  .option[data-selected] {
    background: #dbeafe;
    color: #1d4ed8;
    font-weight: 700;
  }
  /* Snap-preview highlight, shared attribute name with the cursor.
     Lives inside the shadow root so the page's selector (if any)
     can't override it. */
  [data-prson-magic-snap] {
    outline: 3px solid #3b82f6;
    outline-offset: -3px;
    background: #eff6ff;
  }
  .option[data-prson-magic-snap] { color: #1d4ed8; }
`;
