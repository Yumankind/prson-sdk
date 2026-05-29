/**
 * "Point your phone at the screen" overlay shown when the wallet's
 * magic wand emits a `hide` event (the phone is in a non-pointing
 * pose). The visual signals to the user that the cursor is paused
 * and what to do to resume it.
 *
 * Design:
 *   * Full-viewport, fixed-position shadow-DOM container — page
 *     stylesheets cannot leak in.
 *   * A soft inner blue glow on the viewport edge (inset box-shadow
 *     + a thin border) signals "the page is in remote-control mode,
 *     waiting for input".
 *   * A black pill centred in the viewport with the prompt text.
 *   * Auto-dismisses on three triggers:
 *       1. Wallet emits the matching `show` event (handled by
 *          `bindMouse` directly — it calls `close()`).
 *       2. The user moves the real (OS) mouse — `mousemove`
 *          listener calls `close()`.
 *       3. 15-second timeout elapses, so a forgotten controller
 *          doesn't leave the glow on indefinitely.
 *   * `pointer-events: none` on the container so clicks behind it
 *     hit the page normally — the overlay is purely cosmetic.
 */

interface OverlayHandle {
  host: HTMLElement;
  close: () => void;
}

let active: OverlayHandle | null = null;

/** True when the overlay is currently visible. */
export function isPointPhoneOverlayActive(): boolean {
  return active !== null;
}

/** Close any active overlay. Safe to call from anywhere. */
export function closePointPhoneOverlay(): void {
  active?.close();
}

/**
 * Mount the "point your phone" overlay. Replaces any prior overlay
 * so re-firing `hide` while one is up is a no-op visually.
 *
 * Returns the handle so the caller can close it programmatically;
 * the overlay also self-closes on real mouse movement or after the
 * 15-second timeout.
 */
export function openPointPhoneOverlay(): OverlayHandle {
  if (active) return active;

  const host = document.createElement("div");
  host.setAttribute("data-prson-point-phone-overlay", "");
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.zIndex = "2147483645"; // below the cursor (-1) and below the select overlay (-1)
  host.style.pointerEvents = "none";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = OVERLAY_CSS;
  shadow.appendChild(style);

  const glow = document.createElement("div");
  glow.className = "glow";
  shadow.appendChild(glow);

  const pill = document.createElement("div");
  pill.className = "pill";
  pill.innerHTML = `
    <span class="dot"></span>
    <span class="text">Point your phone at the screen to use Magic wand</span>
  `;
  shadow.appendChild(pill);

  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function close(): void {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    window.removeEventListener("mousemove", onRealMouseMove);
    // Tiny fade for polish.
    host.style.transition = "opacity 180ms ease";
    host.style.opacity = "0";
    setTimeout(() => host.remove(), 200);
    if (active && active.host === host) active = null;
  }

  function onRealMouseMove(_e: MouseEvent): void {
    // Any real OS mouse motion → user is no longer relying on the
    // wand; dismiss so the page doesn't keep nagging.
    close();
  }

  window.addEventListener("mousemove", onRealMouseMove);
  timer = setTimeout(close, 15_000);

  const handle: OverlayHandle = { host, close };
  active = handle;
  return handle;
}

// Shadow-DOM CSS. Sized for clear legibility on any host page;
// values picked to match the blue accent of the virtual cursor +
// the snap-preview outline so the user reads the overlay as part
// of the same "remote control" UI family.
const OVERLAY_CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  /* Inner-glow viewport border. Two stacked inset shadows: the
     wide soft halo + a thin defined edge. */
  .glow {
    position: fixed;
    inset: 0;
    pointer-events: none;
    box-shadow:
      inset 0 0 0 2px rgba(59, 130, 246, 0.75),
      inset 0 0 28px 6px rgba(59, 130, 246, 0.35),
      inset 0 0 80px 24px rgba(59, 130, 246, 0.18);
    animation: prson-glow-pulse 2.4s ease-in-out infinite;
  }
  @keyframes prson-glow-pulse {
    0%, 100% { opacity: 0.85; }
    50%      { opacity: 1; }
  }
  .pill {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 18px 28px;
    border-radius: 999px;
    background: #0f172a;
    color: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 0.1px;
    box-shadow:
      0 18px 40px rgba(15, 23, 42, 0.45),
      0 0 0 1px rgba(255, 255, 255, 0.06) inset;
    /* Pulse-fade in so the pill doesn't pop harshly. */
    animation: prson-pill-fade-in 240ms ease-out both;
  }
  @keyframes prson-pill-fade-in {
    from { opacity: 0; transform: translate(-50%, calc(-50% + 6px)); }
    to   { opacity: 1; transform: translate(-50%, -50%); }
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: rgba(59, 130, 246, 1);
    box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.25);
    animation: prson-dot-pulse 1.4s ease-in-out infinite;
    flex: none;
  }
  @keyframes prson-dot-pulse {
    0%, 100% { transform: scale(1);   opacity: 1;    }
    50%      { transform: scale(1.3); opacity: 0.65; }
  }
  .text {
    line-height: 1.25;
  }
`;
