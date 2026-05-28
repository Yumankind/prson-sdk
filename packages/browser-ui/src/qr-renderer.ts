/**
 * QR rendering implementation. The renderer is a single function the
 * base SDK invokes via `window.__prsonLoginQrRenderer(url, mount,
 * theme)`. It draws a styled card containing:
 *
 *   * a high-contrast SVG QR (always dark-on-white for camera
 *     reliability — phone cameras struggle with inverted QRs and
 *     some wallets refuse to scan them),
 *   * a header + subtitle,
 *   * a TTL countdown bar that tracks the server-issued draft
 *     expiry (pulled from the URL's `t=` query param),
 *   * a same-device tap-link in the footer that swaps to a Refresh
 *     button once the countdown expires.
 *
 * The renderer returns a `{ dispose }` handle; the SDK calls
 * `dispose()` when the session completes, the QR expires from the
 * SDK's perspective, or the user navigates away.
 */

import QRCode from "qrcode";

/**
 * Draft TTL in seconds — must mirror `DRAFT_TTL_SECONDS` in the
 * signaling Worker. The QR is generated against a server-stamped
 * `serverTs` we pull out of the URL's `t=` query param, so the
 * countdown matches what the Worker will actually accept.
 *
 * 3 minutes: covers a full mnemonic-holder journey through the
 * wallet drawer (open app → Face ID → identity pick → disclosure
 * pick → confirm) without forcing a mid-flow refresh.
 */
const DRAFT_TTL_SECONDS = 180;

/** Threshold at which the bar + label flip amber. Scaled to ~17% of
 *  the window so the warn state fires with similar relative urgency
 *  regardless of the absolute TTL. */
const COUNTDOWN_WARN_SECONDS = 30;

export interface LoginQrHandle {
  dispose(): void;
}

export type Theme = "light" | "dark" | "auto";

/** Extract the server-issued timestamp from the QR URL. */
function extractServerTs(url: string): number | null {
  try {
    // Universal-link URLs parse cleanly; the `prson://` custom
    // scheme used to be the default and may still arrive from
    // older verifier builds, so we keep the regex fallback.
    try {
      const parsed = new URL(url);
      const t = parsed.searchParams.get("t");
      if (t) return parseInt(t, 10);
    } catch {
      /* fall through to regex */
    }
    // `noUncheckedIndexedAccess` is on, so `m[1]` is typed as
    // `string | undefined` even though a successful match guarantees
    // the capturing group. Pull it out into a local + null-guard so
    // TypeScript is happy without a non-null assertion.
    const m = url.match(/[?&]t=([0-9]+)/);
    const cap = m?.[1];
    return cap ? parseInt(cap, 10) : null;
  } catch {
    return null;
  }
}

function fmtSeconds(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ":" + String(r).padStart(2, "0");
}

/**
 * Render the QR card into [mount]. Returns the dispose handle the
 * SDK uses to tear it down. [theme] is currently unused — the QR
 * itself is always dark-on-white for scan reliability; the card
 * chrome around it follows `prefers-color-scheme` via the CSS
 * variables in `styles.ts`.
 */
export function renderQrCard(
  url: string,
  mount: HTMLElement,
  _theme: Theme,
): LoginQrHandle {
  // Belt-and-suspenders mount guard. The base SDK's concurrency
  // guard ensures only one sign-in is in flight at a time, so in the
  // happy path the mount is always empty when we land here. But a
  // host page that calls `renderQrCard` directly (the manual
  // export) — or that has stale DOM left from a previous session
  // whose dispose() never ran — could end up with two stacked
  // cards. Strip any prior `prson-qr-card` in the mount before
  // appending the new one.
  //
  // The `setInterval` from the orphan card leaks (we don't hold a
  // reference to it), but that's acceptable for this exceptional
  // path — the user signed in twice without the SDK lifecycle in
  // between, and the interval is a single 1 Hz tick on a removed
  // node. The next full page navigation reaps it.
  // `Array.from` because the `ES2020` lib target doesn't include the
  // iterable-NodeList ambient declaration — same behaviour as a
  // plain `for..of`, satisfies the type checker.
  Array.from(mount.querySelectorAll(".prson-qr-card")).forEach((orphan) => {
    orphan.remove();
  });

  const card = document.createElement("div");
  card.className = "prson-qr-card";
  card.setAttribute("data-prson-login-ui", "1");

  const head = document.createElement("div");
  head.className = "prson-qr-card-head";
  const title = document.createElement("div");
  title.className = "prson-qr-card-title";
  title.textContent = "Scan with your Prson wallet";
  const subtitle = document.createElement("div");
  subtitle.className = "prson-qr-card-subtitle";
  subtitle.textContent = "Open the app and point your camera at this code.";
  head.append(title, subtitle);

  const frame = document.createElement("div");
  frame.className = "prson-qr-frame";

  QRCode.toString(
    url,
    {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      color: { dark: "#000000", light: "#FFFFFF" },
    },
    (err: Error | null | undefined, svgString: string) => {
      if (err) {
        frame.textContent = "QR render failed";
        return;
      }
      frame.innerHTML = svgString;
    },
  );

  // ── Countdown row ────────────────────────────────────────────
  const countdown = document.createElement("div");
  countdown.className = "prson-qr-countdown";
  const countdownLabel = document.createElement("div");
  countdownLabel.className = "prson-qr-countdown-label";
  const track = document.createElement("div");
  track.className = "prson-qr-countdown-track";
  const fill = document.createElement("div");
  fill.className = "prson-qr-countdown-fill";
  track.append(fill);
  countdown.append(countdownLabel, track);

  const foot = document.createElement("div");
  foot.className = "prson-qr-foot";
  // Use anchor-creation rather than innerHTML to keep the URL
  // un-escaped without exposing the partner page to attribute
  // injection if `url` ever contains a quote.
  const tapPrefix = document.createTextNode("Or ");
  const tapLink = document.createElement("a");
  tapLink.href = url;
  tapLink.textContent = "tap here";
  const tapSuffix = document.createTextNode(
    " if you're on the same device.",
  );
  foot.append(tapPrefix, tapLink, tapSuffix);

  card.append(head, frame, countdown, foot);
  mount.append(card);

  // ── Countdown logic ──────────────────────────────────────────
  const serverTs = extractServerTs(url);
  const deadlineMs = serverTs
    ? serverTs * 1000 + DRAFT_TTL_SECONDS * 1000
    : Date.now() + DRAFT_TTL_SECONDS * 1000;

  let tickHandle: number | null = null;
  let expired = false;

  function tick() {
    const remainingMs = deadlineMs - Date.now();
    const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
    countdownLabel.textContent =
      remaining > 0 ? "Expires in " + fmtSeconds(remaining) : "QR code expired";
    const ratio = Math.max(
      0,
      Math.min(1, remainingMs / (DRAFT_TTL_SECONDS * 1000)),
    );
    fill.style.transform = "scaleX(" + ratio + ")";

    if (remaining <= 0 && !expired) {
      expired = true;
      countdown.dataset.state = "expired";
      card.dataset.expired = "1";
      foot.replaceChildren();
      const note = document.createElement("div");
      note.textContent = "This code is no longer valid.";
      const refresh = document.createElement("button");
      refresh.className = "prson-qr-refresh";
      refresh.type = "button";
      refresh.textContent = "Generate a new code";
      // We don't know the partner's sign-in trigger, so emit a
      // CustomEvent the host page can listen for to re-enter
      // signIn(). The example HTML wires this to its "#signin"
      // button via a document-level listener.
      refresh.addEventListener("click", () => {
        const evt = new CustomEvent("prson-login-refresh-requested", {
          bubbles: true,
        });
        card.dispatchEvent(evt);
      });
      foot.append(note, refresh);
    } else if (remaining <= COUNTDOWN_WARN_SECONDS && remaining > 0) {
      countdown.dataset.state = "warn";
    } else if (remaining > COUNTDOWN_WARN_SECONDS) {
      countdown.dataset.state = "";
    }
  }

  tick();
  tickHandle = window.setInterval(tick, 1000);

  return {
    dispose() {
      if (tickHandle != null) {
        window.clearInterval(tickHandle);
        tickHandle = null;
      }
      card.remove();
    },
  };
}
