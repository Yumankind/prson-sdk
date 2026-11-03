/**
 * The sign-in card. The base SDK calls
 * `window.__prsonLoginQrRenderer(url, mount, theme, context?)` and gets
 * back `{ dispose, update }`. The card shows:
 *
 *   * the site being signed in to, large, with a monogram — the main cue
 *     against QR relay phishing, with "Only scan codes shown on <site>";
 *   * on computers: a large, always dark-on-white QR in a branded frame
 *     whose border is the countdown ring; on phones: one "Open Prson"
 *     button (the same universal link) and a way to show the code anyway;
 *   * exactly what the site will get, read from the code's own request;
 *   * the progress the SDK reports (`update`): phone connected, receiving
 *     the proof, checking it, signed in (a check that draws itself; still
 *     under reduced motion), or an error with "Try again";
 *   * expiry with a one-tap "Get a new code".
 *
 * Nothing on the card is a secret or a reusable code: the QR is single-use,
 * bound to this browser's key and expires in minutes. The URL is never
 * printed as text or offered for copying.
 *
 * Renderers from 0.1 took three arguments and returned `{ dispose }`; the
 * SDK still accepts those, and this one still works with a 0.1 SDK (no
 * `context`: inline layout, refresh by DOM event only).
 */

import QRCode from "qrcode";
import { prsonMarkSvg } from "./button.js";
import { describeCode, monogram, type ShareIcon } from "./describe.js";

/**
 * Draft TTL in seconds — must mirror `DRAFT_TTL_SECONDS` in the
 * signaling Worker. The countdown runs from the server-stamped `serverTs`
 * in the URL's `t=` query param, so it matches what the Worker accepts.
 */
const DRAFT_TTL_SECONDS = 180;

/** The ring and the time turn amber-600 for the last 30 seconds. */
const COUNTDOWN_WARN_SECONDS = 30;

export interface LoginQrHandle {
  dispose(): void;
  update?(state: LoginUiState): void | Promise<void>;
}

export type Theme = "light" | "dark" | "auto";

/** Mirrors `LoginUiState` in @prson/login-sdk (kept local so this package has no hard dependency on it). */
export type LoginUiState =
  | { state: "waiting" }
  | { state: "scanned" }
  | { state: "approving" }
  | { state: "verifying" }
  | { state: "success"; domain: string }
  | { state: "error"; message: string };

/** Mirrors `LoginQrContext` in @prson/login-sdk. */
export interface LoginQrContext {
  mode: "modal" | "inline";
  domain: string;
  refresh?: () => void;
  cancel?: () => void;
  getAppUrl: string;
  titleId: string;
}

const svg = (body: string, cls = "") =>
  `<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

const ICONS: Record<ShareIcon | "close" | "lock" | "clock" | "alert" | "refresh" | "device", string> = {
  shield: svg('<path d="M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7l8-4z"/><path d="M9 12l2 2 4-4"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M6 21v-1a6 6 0 0 1 12 0v1"/>'),
  calendar: svg('<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M16 3v4M8 3v4M4 11h16"/>'),
  id: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M15 9h2M15 13h2M7 16h4"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
  phone: svg('<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>'),
  device: svg('<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>'),
  home: svg('<path d="M5 12H3l9-9 9 9h-2"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>'),
  building: svg('<path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9v.01M9 12v.01M9 15v.01"/>'),
  key: svg('<circle cx="8" cy="15" r="4"/><path d="M10.85 12.15L19 4M18 5l2 2M15 8l2 2"/>'),
  flag: svg('<path d="M5 5a5 5 0 0 1 7 0 5 5 0 0 0 7 0v9a5 5 0 0 1-7 0 5 5 0 0 0-7 0V5z"/><path d="M5 21v-7"/>'),
  check: svg('<path d="M5 12l5 5L20 7"/>'),
  close: svg('<path d="M18 6L6 18M6 6l12 12"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>'),
  alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>'),
  refresh: svg('<path d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4"/>'),
};
const SPINNER = svg('<path d="M12 3a9 9 0 1 0 9 9" />', "prson-spinner");
const CHECK = `<svg class="prson-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

/** Soft tiles with ink text (≥ 12:1), picked by the domain so a site always looks the same. */
const MONO_TINTS = ["#FEF3C7", "#E0F2FE", "#DCFCE7", "#EDE9FE", "#FCE7F3", "#E2E8F0", "#FFEDD5"];
function tintFor(domain: string): string {
  let h = 0;
  for (let i = 0; i < domain.length; i++) h = (h * 31 + domain.charCodeAt(i)) >>> 0;
  return MONO_TINTS[h % MONO_TINTS.length]!;
}

function fmtSeconds(seconds: number): string {
  const s = Math.max(0, seconds);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A phone or small tablet, where the Prson app is (or would be) on this device. */
function isPhone(): boolean {
  const ua = navigator.userAgent || "";
  if (/iPhone|iPod|Android.+Mobile|Windows Phone|Mobile Safari/i.test(ua)) return true;
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches &&
    window.matchMedia("(max-width: 820px)").matches
  );
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/**
 * Render the sign-in card into [mount]. Returns the handle the SDK uses
 * to report progress and tear it down.
 */
export function renderQrCard(url: string, mount: HTMLElement, theme: Theme, context?: LoginQrContext): LoginQrHandle {
  // A host page that calls this directly, or stale DOM from a session
  // whose dispose() never ran, could stack two cards: drop older ones.
  Array.from(mount.querySelectorAll(".prson-card, .prson-qr-card")).forEach((orphan) => orphan.remove());

  const info = describeCode(url);
  const domain = context?.domain || info.domain || window.location.host;
  const mode = context?.mode ?? "inline";
  const titleId = context?.titleId ?? `prson-login-title-${Math.random().toString(36).slice(2, 10)}`;
  const getAppUrl = context?.getAppUrl ?? "https://app.prson.net/";
  const phone = isPhone();
  const sheet = mode === "modal" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 480px)").matches;

  const card = el("section", "prson-card");
  card.setAttribute("data-prson-login-ui", "1");
  card.dataset.theme = theme === "light" || theme === "dark" ? theme : "auto";
  card.dataset.mode = mode;
  card.dataset.device = phone ? "phone" : "desktop";
  card.dataset.state = "waiting";
  if (sheet) card.dataset.sheet = "1";
  card.setAttribute("aria-labelledby", titleId);
  // Kept for hosts that styled the 0.1 card.
  card.classList.add("prson-qr-card");

  // Header: brand + close (dialog only).
  const head = el("div", "prson-head");
  const brand = el("span", "prson-brand", prsonMarkSvg({ size: 22 }));
  brand.append(document.createTextNode("Sign in with Prson"));
  head.append(brand);
  if (mode === "modal" && context?.cancel) {
    const close = el("button", "prson-close", ICONS.close);
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => context.cancel?.());
    head.append(close);
  }

  // The site, big.
  const site = el("div", "prson-site");
  const mono = el("div", "prson-monogram");
  mono.textContent = monogram(domain);
  mono.style.setProperty("--prson-mono-bg", tintFor(domain));
  mono.setAttribute("aria-hidden", "true");
  const siteText = el("div", "prson-site-text");
  const eyebrow = el("p", "prson-eyebrow");
  eyebrow.textContent = "Sign in to";
  const title = el("h2", "prson-domain");
  title.id = titleId;
  title.textContent = domain;
  // "Sign in to shop.example.com" for screen readers in one go.
  title.setAttribute("aria-label", `Sign in to ${domain}`);
  siteText.append(eyebrow, title);
  site.append(mono, siteText);

  // The stage: the code (computers) or the Open Prson button (phones), with
  // the state overlay on top.
  const stage = el("div", "prson-stage");
  const frame = el("div", "prson-frame");
  const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ring.setAttribute("class", "prson-ring");
  ring.setAttribute("viewBox", "0 0 272 272");
  ring.setAttribute("aria-hidden", "true");
  ring.innerHTML =
    '<rect class="prson-ring-track" x="2" y="2" width="268" height="268" rx="24" pathLength="100"/>' +
    '<rect class="prson-ring-fill" x="2" y="2" width="268" height="268" rx="24" pathLength="100"/>';
  const ringFill = ring.querySelector(".prson-ring-fill") as SVGRectElement;
  const code = el("div", "prson-code");
  code.setAttribute("role", "img");
  code.setAttribute("aria-label", `Sign-in code for ${domain}. Scan it with the Prson app.`);
  QRCode.toString(
    url,
    { type: "svg", errorCorrectionLevel: "H", margin: 0, color: { dark: "#0A0A0A", light: "#FFFFFF" } },
    (err: Error | null | undefined, svgString: string) => {
      if (err) {
        code.textContent = "The code couldn't be drawn. Use Get a new code.";
        return;
      }
      code.innerHTML = svgString.replace("<svg ", '<svg class="prson-qr" aria-hidden="true" focusable="false" ');
      const logo = el("span", "prson-code-logo", prsonMarkSvg({ size: 36 }));
      code.append(logo);
    },
  );
  frame.append(ring, code);

  const open = el("div", "prson-open");
  const openBtn = el("a", "prson-btn prson-btn--big", prsonMarkSvg({ size: 26, square: "#0A0A0A", glyph: "#FBBF24" }));
  openBtn.href = url;
  openBtn.append(document.createTextNode("Open Prson"));
  const showCode = el("button", "prson-linkish");
  showCode.type = "button";
  showCode.textContent = "Scan with another phone instead";
  showCode.setAttribute("aria-expanded", "false");
  showCode.addEventListener("click", () => {
    const on = card.dataset.showCode !== "1";
    card.dataset.showCode = on ? "1" : "";
    showCode.setAttribute("aria-expanded", String(on));
    showCode.textContent = on ? "Hide the code" : "Scan with another phone instead";
  });
  open.append(openBtn, showCode);

  const overlay = el("div", "prson-overlay");
  const overlayIcon = el("div", "prson-overlay-icon");
  const overlayTitle = el("p", "prson-overlay-title");
  const overlayText = el("p", "prson-overlay-text");
  overlay.append(overlayIcon, overlayTitle, overlayText);
  // Over the code on computers, over the Open Prson button on phones.
  (phone ? open : frame).append(overlay);

  const timer = el("p", "prson-timer");
  stage.append(frame, open);
  if (!phone) stage.append(el("p", "prson-hint", "Open <b>Prson</b> on your phone and scan this code."));
  stage.append(timer);

  // What the site gets.
  const share = el("div", "prson-share");
  const shareTitle = el("p", "prson-share-title");
  shareTitle.textContent = `${domain} will get`;
  const list = el("ul");
  list.setAttribute("aria-label", `What ${domain} will get`);
  for (const item of info.shares) {
    const li = el("li", "", ICONS[item.icon]);
    const text = el("span");
    text.textContent = item.label;
    if (item.detail) {
      const small = el("small");
      small.textContent = item.detail;
      text.append(small);
    }
    li.append(text);
    list.append(li);
  }
  share.append(shareTitle, list);
  if (info.anonymousAllowed) {
    const note = el("p", "prson-share-note");
    note.textContent = "You can also choose to sign in anonymously in the app.";
    share.append(note);
  }

  // The anti-relay cue.
  const guard = el("p", "prson-guard", ICONS.lock);
  const guardText = el("span");
  guardText.append(document.createTextNode("Only scan codes shown on "));
  const guardDomain = el("b");
  guardDomain.textContent = domain;
  guardText.append(guardDomain, document.createTextNode(". Never scan one someone sent you."));
  guard.append(guardText);

  const foot = el("p", "prson-foot");
  foot.append(document.createTextNode("Don't have Prson? "));
  const get = el("a");
  get.href = getAppUrl;
  get.target = "_blank";
  get.rel = "noopener";
  get.textContent = "Get the app";
  foot.append(get);

  const live = el("div", "prson-sr");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("role", "status");

  card.append(head, site, stage, share, guard, foot, live);
  mount.append(card);

  const announce = (text: string) => {
    live.textContent = "";
    // A tick later, so the same text twice is still read.
    setTimeout(() => (live.textContent = text), 50);
  };
  announce(phone ? `Sign in to ${domain}. Open Prson to continue.` : `Sign in to ${domain}. Scan the code with the Prson app.`);

  // ── Countdown ────────────────────────────────────────────────
  // From the server's own timestamp, unless this computer's clock is
  // clearly off (then from now).
  const nowS = Date.now() / 1000;
  const startS = info.serverTs && Math.abs(nowS - info.serverTs) < 60 ? info.serverTs : nowS;
  const deadlineMs = (startS + DRAFT_TTL_SECONDS) * 1000;
  let tickHandle: number | null = null;
  let expired = false;
  let warned = false;
  let settled = false; // success or error: the countdown no longer matters
  const timers: number[] = [];

  function action(label: string, icon: string, onClick: () => void): HTMLButtonElement {
    const b = el("button", "prson-btn", icon);
    b.type = "button";
    b.append(document.createTextNode(label));
    b.addEventListener("click", onClick);
    return b;
  }

  /** Ask for a fresh code: the 0.1 DOM event first, then the SDK (a no-op if the host already re-called signIn()). */
  function requestRefresh(): void {
    card.dispatchEvent(new CustomEvent("prson-login-refresh-requested", { bubbles: true }));
    context?.refresh?.();
  }

  function setOverlay(icon: string, titleText: string, text: string, button?: HTMLButtonElement, pulse = false) {
    overlayIcon.innerHTML = icon;
    overlayIcon.classList.toggle("prson-pulse", pulse);
    overlayTitle.textContent = titleText;
    overlayText.textContent = text;
    overlay.querySelector(".prson-btn")?.remove();
    if (button) {
      overlay.append(button);
      // Move focus to the one thing to do next (the dialog keeps it inside).
      if (mount.contains(document.activeElement) || mode === "modal") setTimeout(() => button.focus(), 30);
    }
  }

  function tick() {
    if (settled) return;
    const remainingMs = deadlineMs - Date.now();
    const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
    const ratio = Math.max(0, Math.min(1, remainingMs / (DRAFT_TTL_SECONDS * 1000)));
    ringFill.style.strokeDashoffset = String(100 - ratio * 100);
    if (remaining > 0) {
      timer.innerHTML = `Code expires in <b>${fmtSeconds(remaining)}</b>`;
      card.dataset.urgency = remaining <= COUNTDOWN_WARN_SECONDS ? "warn" : "";
      if (remaining <= COUNTDOWN_WARN_SECONDS && !warned) {
        warned = true;
        announce("30 seconds left on this code.");
      }
    } else if (!expired && card.dataset.state === "waiting") {
      expired = true;
      card.dataset.state = "expired";
      timer.textContent = "";
      setOverlay(ICONS.clock, "This code expired", "Codes last 3 minutes, so a copied one is useless.", action("Get a new code", ICONS.refresh, requestRefresh));
      announce("The code expired. Get a new code to continue.");
    }
  }
  tick();
  tickHandle = window.setInterval(tick, 1000);

  return {
    dispose() {
      if (tickHandle != null) window.clearInterval(tickHandle);
      tickHandle = null;
      timers.forEach((t) => window.clearTimeout(t));
      card.remove();
    },
    update(s: LoginUiState): void | Promise<void> {
      if (!card.isConnected) return;
      card.dataset.state = s.state;
      switch (s.state) {
        case "waiting":
          return;
        case "scanned":
          setOverlay(ICONS.device, "Phone connected", "Finishing on your phone…", undefined, true);
          announce("Phone connected. Finishing on your phone.");
          return;
        case "approving":
          setOverlay(SPINNER, "Receiving your proof", "Your phone is sending a signed, encrypted proof.");
          return;
        case "verifying":
          setOverlay(SPINNER, "Checking the proof", "Almost there.");
          announce("Checking the proof.");
          return;
        case "success": {
          settled = true;
          setOverlay(CHECK, "Signed in", `You're signed in to ${s.domain || domain}.`);
          announce(`You're signed in to ${s.domain || domain}.`);
          // Long enough to see the check; short when motion is reduced.
          const hold = prefersReducedMotion() ? 450 : 1000;
          return new Promise<void>((resolve) => timers.push(window.setTimeout(resolve, hold)));
        }
        case "error":
          settled = true;
          timer.textContent = "";
          setOverlay(ICONS.alert, "Sign-in didn't finish", s.message, action("Try again", ICONS.refresh, requestRefresh));
          announce(`Sign-in didn't finish. ${s.message}`);
          return;
      }
    },
  };
}
