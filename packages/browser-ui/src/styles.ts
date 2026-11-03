/**
 * CSS bundled with the UI package and injected at import-time via a
 * single `<style data-prson-login-ui>` tag.
 *
 * Embedding the stylesheet in JS rather than shipping a sidecar
 * `.css` file is deliberate — the goal of `@prson/login-sdk-ui` is
 * "drop one script tag and get a working sign-in". A separate
 * stylesheet adds a second HTTP fetch + a partner-side concatenation
 * step we don't want.
 *
 * Two parts:
 *   * the sign-in card (`.prson-card`, under `[data-prson-login-ui]`),
 *     themed with `--prson-*` custom properties: override them on
 *     `[data-prson-login-ui]` with higher specificity;
 *   * the "Sign in with Prson" button (`.prson-signin-btn`), which lives
 *     on the host page.
 *
 * Brand: ink #0A0A0A, muted #52525B, amber #FBBF24 with ink text for the
 * primary action, Inter. Light first; dark follows `prefers-color-scheme`
 * for `theme: "auto"` or is forced with `theme: "dark"`. Every animation
 * stops under `prefers-reduced-motion: reduce`.
 */

const DARK_VARS = `
    --prson-bg: #18181B;
    --prson-fg: #FAFAFA;
    --prson-muted: #A1A1AA;
    --prson-soft: #232327;
    --prson-line: rgba(255, 255, 255, 0.10);
    --prson-line-strong: rgba(255, 255, 255, 0.20);
    --prson-accent-text: #FBBF24;
    --prson-focus: #FBBF24;
    --prson-danger: #FCA5A5;
    --prson-danger-soft: rgba(248, 113, 113, 0.14);
    --prson-ring-track: rgba(255, 255, 255, 0.12);
    --prson-shadow: 0 24px 64px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.4);`;

export const PRSON_LOGIN_UI_CSS = `
[data-prson-login-ui] {
  --prson-bg: #FFFFFF;
  --prson-fg: #0A0A0A;
  --prson-muted: #52525B;
  --prson-soft: #FAFAF9;
  --prson-line: rgba(10, 10, 10, 0.08);
  --prson-line-strong: rgba(10, 10, 10, 0.16);
  --prson-amber: #FBBF24;
  --prson-amber-hover: #F59E0B;
  --prson-accent-text: #B45309;
  --prson-focus: #0A0A0A;
  --prson-danger: #B91C1C;
  --prson-danger-soft: #FEF2F2;
  --prson-ring-track: rgba(10, 10, 10, 0.08);
  --prson-shadow: 0 24px 64px rgba(10, 10, 10, 0.18), 0 2px 6px rgba(10, 10, 10, 0.06);
  --prson-radius: 24px;
  --prson-font: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif;
  --prson-spring: cubic-bezier(0.16, 1, 0.3, 1);
}
[data-prson-login-ui][data-theme="dark"] {${DARK_VARS}
}
@media (prefers-color-scheme: dark) {
  [data-prson-login-ui][data-theme="auto"] {${DARK_VARS}
  }
}

/* ── The card ───────────────────────────────────────────────────── */
.prson-card {
  box-sizing: border-box;
  position: relative;
  width: 400px;
  max-width: 100%;
  padding: 20px 24px 20px;
  background: var(--prson-bg);
  color: var(--prson-fg);
  border: 1px solid var(--prson-line);
  border-radius: var(--prson-radius);
  box-shadow: var(--prson-shadow);
  font-family: var(--prson-font);
  font-size: 14px;
  line-height: 1.45;
  text-align: left;
  -webkit-font-smoothing: antialiased;
  animation: prson-enter 320ms var(--prson-spring);
}
.prson-card *, .prson-card *::before, .prson-card *::after { box-sizing: border-box; }
.prson-card[data-mode="inline"] { margin-top: 24px; box-shadow: 0 8px 24px rgba(10, 10, 10, 0.06), 0 1px 3px rgba(10, 10, 10, 0.05); }
.prson-card[data-sheet="1"] {
  width: 100%;
  border-radius: var(--prson-radius) var(--prson-radius) 0 0;
  border-bottom: 0;
  padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  animation-name: prson-sheet;
}
@keyframes prson-enter { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes prson-sheet { from { transform: translateY(100%); } to { transform: none; } }

.prson-card button, .prson-card a { font-family: inherit; }
.prson-card :focus-visible { outline: 3px solid var(--prson-focus); outline-offset: 2px; border-radius: 10px; }

.prson-head { display: flex; align-items: center; gap: 8px; min-height: 44px; margin: -4px -8px 4px 0; }
.prson-brand { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--prson-muted); letter-spacing: -0.1px; }
.prson-brand .prson-mark { display: block; }
.prson-close {
  margin-left: auto; width: 44px; height: 44px; display: inline-grid; place-items: center;
  border: 0; border-radius: 12px; background: transparent; color: var(--prson-muted); cursor: pointer;
}
.prson-close:hover { background: var(--prson-soft); color: var(--prson-fg); }
.prson-close svg { width: 20px; height: 20px; }

.prson-site { display: flex; align-items: center; gap: 14px; margin: 4px 0 18px; min-width: 0; }
.prson-monogram {
  flex: none; width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center;
  font-size: 22px; font-weight: 700; letter-spacing: -0.5px; color: #0A0A0A;
  background: var(--prson-mono-bg, #FEF3C7);
  box-shadow: inset 0 0 0 1px rgba(10, 10, 10, 0.06);
}
.prson-site-text { min-width: 0; }
.prson-eyebrow { margin: 0; font-size: 13px; color: var(--prson-muted); }
.prson-domain {
  margin: 0; font-size: 24px; line-height: 1.15; font-weight: 700; letter-spacing: -0.6px;
  color: var(--prson-fg); overflow-wrap: anywhere;
}

/* ── The code, its frame and the countdown ring ─────────────────── */
.prson-stage { position: relative; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.prson-frame { position: relative; width: 272px; height: 272px; max-width: 100%; aspect-ratio: 1; }
.prson-ring { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.prson-ring rect { fill: none; stroke-width: 4; }
.prson-ring .prson-ring-track { stroke: var(--prson-ring-track); }
.prson-ring .prson-ring-fill {
  stroke: var(--prson-amber); stroke-linecap: round;
  stroke-dasharray: 100 100; transition: stroke-dashoffset 1s linear, stroke 300ms ease;
}
.prson-card[data-urgency="warn"] .prson-ring-fill { stroke: #D97706; }
.prson-code {
  position: absolute; inset: 10px; border-radius: 18px; background: #FFFFFF; /* always white: cameras need contrast */
  display: grid; place-items: center; padding: 12px;
  box-shadow: inset 0 0 0 1px rgba(10, 10, 10, 0.06);
  transition: filter 300ms ease, opacity 300ms ease;
}
.prson-code svg.prson-qr { display: block; width: 100%; height: 100%; }
.prson-code-logo {
  position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; margin: -22px 0 0 -22px;
  border-radius: 12px; background: #FFFFFF; display: grid; place-items: center;
}
.prson-code-logo .prson-mark { width: 36px; height: 36px; }
.prson-card[data-state]:not([data-state="waiting"]) .prson-code { filter: blur(3px); opacity: 0.25; }
.prson-card[data-state="waiting"] .prson-code { filter: none; opacity: 1; }

.prson-overlay {
  position: absolute; inset: 10px; border-radius: 18px; display: none;
  flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 18px; text-align: center;
  background: var(--prson-bg);
  background: color-mix(in srgb, var(--prson-bg) 82%, transparent);
  animation: prson-fade 220ms ease;
}
.prson-card:not([data-state="waiting"]) .prson-overlay { display: flex; }
@keyframes prson-fade { from { opacity: 0; } to { opacity: 1; } }
.prson-overlay-icon { width: 56px; height: 56px; display: grid; place-items: center; border-radius: 50%; margin-bottom: 6px; background: var(--prson-soft); color: var(--prson-fg); }
.prson-overlay-icon svg { width: 28px; height: 28px; }
.prson-overlay-title { margin: 0; font-size: 17px; font-weight: 700; letter-spacing: -0.3px; color: var(--prson-fg); }
.prson-overlay-text { margin: 0; font-size: 13.5px; color: var(--prson-muted); max-width: 230px; }
.prson-overlay .prson-btn { margin-top: 10px; }
.prson-card[data-state="error"] .prson-overlay-icon { background: var(--prson-danger-soft); color: var(--prson-danger); }

.prson-spinner { width: 28px; height: 28px; animation: prson-spin 900ms linear infinite; }
@keyframes prson-spin { to { transform: rotate(360deg); } }
.prson-pulse { animation: prson-pulse 1.6s ease-in-out infinite; }
@keyframes prson-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.45); } 50% { box-shadow: 0 0 0 10px rgba(251, 191, 36, 0); } }

/* Success: an amber disc pops in and the check draws itself. */
.prson-card[data-state="success"] .prson-overlay-icon { background: var(--prson-amber); color: #0A0A0A; width: 72px; height: 72px; animation: prson-pop 420ms var(--prson-spring); }
.prson-card[data-state="success"] .prson-overlay-icon svg { width: 36px; height: 36px; }
.prson-check path { stroke-dasharray: 24; stroke-dashoffset: 24; animation: prson-draw 380ms 160ms ease-out forwards; }
@keyframes prson-pop { 0% { transform: scale(0.4); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); } }
@keyframes prson-draw { to { stroke-dashoffset: 0; } }
.prson-card[data-state="success"] .prson-ring-fill { stroke: var(--prson-amber); stroke-dashoffset: 0 !important; }

.prson-timer { margin: 0; min-height: 20px; font-size: 13px; color: var(--prson-muted); font-variant-numeric: tabular-nums; }
.prson-timer b { color: var(--prson-fg); font-weight: 600; }
.prson-card[data-urgency="warn"] .prson-timer b { color: var(--prson-accent-text); }
.prson-card[data-state="success"] .prson-timer, .prson-card[data-state="error"] .prson-timer { visibility: hidden; }
.prson-hint { margin: 0; font-size: 13px; color: var(--prson-muted); text-align: center; }
.prson-card:not([data-state="waiting"]) .prson-hint { visibility: hidden; }
.prson-hint b { color: var(--prson-fg); font-weight: 600; }

/* ── Phones: one big "Open Prson" button ───────────────────────── */
.prson-open { position: relative; display: flex; flex-direction: column; align-items: stretch; justify-content: center; gap: 10px; width: 100%; }
.prson-card[data-device="phone"] .prson-frame { display: none; }
.prson-card[data-device="phone"][data-show-code="1"] .prson-frame { display: block; }
.prson-card[data-device="desktop"] .prson-open { display: none; }
.prson-card[data-device="phone"] .prson-overlay { inset: 0; }
.prson-card[data-device="phone"]:not([data-state="waiting"]) .prson-open { min-height: 236px; }
.prson-card[data-device="phone"]:not([data-state="waiting"]) .prson-open > :not(.prson-overlay) { visibility: hidden; }
.prson-linkish {
  min-height: 44px; border: 0; background: transparent; color: var(--prson-fg); cursor: pointer;
  font-size: 14px; font-weight: 500; text-decoration: underline; text-underline-offset: 3px; padding: 0 8px;
}

/* ── Buttons inside the card ───────────────────────────────────── */
.prson-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  min-height: 48px; padding: 0 20px; border-radius: 14px; border: 0; cursor: pointer;
  font-size: 15px; font-weight: 600; letter-spacing: -0.1px; text-decoration: none;
  background: var(--prson-amber); color: #0A0A0A;
  transition: background-color 150ms ease, transform 80ms ease;
}
.prson-btn:hover { background: var(--prson-amber-hover); }
.prson-btn:active { transform: translateY(1px); }
.prson-btn--big { min-height: 56px; font-size: 16px; border-radius: 16px; }
.prson-btn .prson-mark { flex: none; }
.prson-btn { white-space: nowrap; }
.prson-btn svg:not(.prson-mark) { flex: none; width: 20px; height: 20px; }

/* ── What the site gets ────────────────────────────────────────── */
.prson-share { margin: 18px 0 0; padding: 14px 16px; border-radius: 16px; background: var(--prson-soft); border: 1px solid var(--prson-line); }
.prson-share-title { margin: 0 0 8px; font-size: 12.5px; font-weight: 600; color: var(--prson-muted); letter-spacing: 0.1px; }
.prson-share ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.prson-share li { display: flex; align-items: flex-start; gap: 10px; font-size: 14px; color: var(--prson-fg); }
.prson-share li svg { flex: none; width: 18px; height: 18px; margin-top: 1px; color: var(--prson-fg); opacity: 0.8; }
.prson-share li small { display: block; font-size: 12.5px; color: var(--prson-muted); }
.prson-share-note { margin: 10px 0 0; font-size: 12.5px; color: var(--prson-muted); }

/* ── Anti-relay cue and footer ─────────────────────────────────── */
.prson-guard { display: flex; gap: 8px; align-items: flex-start; margin: 14px 2px 0; font-size: 12.5px; color: var(--prson-muted); }
.prson-guard svg { flex: none; width: 16px; height: 16px; margin-top: 1px; }
.prson-guard b { color: var(--prson-fg); font-weight: 600; overflow-wrap: anywhere; }
.prson-foot { margin: 12px 0 0; padding-top: 12px; border-top: 1px solid var(--prson-line); font-size: 13px; color: var(--prson-muted); text-align: center; }
.prson-foot a { color: var(--prson-fg); font-weight: 600; text-decoration: underline; text-underline-offset: 3px; display: inline-block; padding: 12px 4px; margin: -12px 0; }

.prson-sr { position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

@media (max-width: 380px) {
  .prson-card { padding: 16px 16px 18px; }
  .prson-frame { width: 248px; height: 248px; }
  .prson-domain { font-size: 21px; }
}

/* ── "Sign in with Prson" button (host page) ────────────────────── */
.prson-signin-btn {
  box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  min-height: 44px; padding: 0 18px 0 12px; border-radius: 12px; cursor: pointer;
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif;
  font-size: 15px; font-weight: 600; line-height: 1; letter-spacing: -0.1px; white-space: nowrap;
  border: 1px solid transparent; text-decoration: none; -webkit-font-smoothing: antialiased;
  transition: background-color 150ms ease, border-color 150ms ease, transform 80ms ease;
}
.prson-signin-btn .prson-mark { flex: none; display: block; }
.prson-signin-btn:focus-visible { outline: 3px solid #0A0A0A; outline-offset: 2px; }
.prson-signin-btn:active:not(:disabled) { transform: translateY(1px); }
.prson-signin-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.prson-signin-btn--lg { min-height: 52px; padding: 0 22px 0 14px; font-size: 16px; border-radius: 14px; }
.prson-signin-btn--block { display: flex; width: 100%; }
.prson-signin-btn--amber { background: #FBBF24; color: #0A0A0A; }
.prson-signin-btn--amber:hover:not(:disabled) { background: #F59E0B; }
.prson-signin-btn--dark { background: #0A0A0A; color: #FFFFFF; }
.prson-signin-btn--dark:hover:not(:disabled) { background: #27272A; }
.prson-signin-btn--dark:focus-visible { outline-color: #D97706; }
.prson-signin-btn--light { background: #FFFFFF; color: #0A0A0A; border-color: rgba(10, 10, 10, 0.16); }
.prson-signin-btn--light:hover:not(:disabled) { background: #FAFAF9; border-color: rgba(10, 10, 10, 0.28); }
.prson-signin-btn--light:focus-visible { outline-color: #FBBF24; }
.prson-signin-btn--outline { background: transparent; color: inherit; border: 1.5px solid currentColor; }
.prson-signin-btn--outline:hover:not(:disabled) { background: rgba(127, 127, 127, 0.10); }
.prson-signin-btn--outline:focus-visible { outline-color: currentColor; }
.prson-signin-btn--busy { cursor: progress; }
.prson-signin-btn--busy .prson-mark { animation: prson-busy 1s ease-in-out infinite; }
@keyframes prson-busy { 50% { opacity: 0.35; } }
prson-signin-button { display: inline-block; }

@media (prefers-reduced-motion: reduce) {
  .prson-card, .prson-card *, .prson-signin-btn, .prson-signin-btn * {
    animation: none !important;
    transition: none !important;
  }
  .prson-check path { stroke-dashoffset: 0; }
  .prson-signin-btn:active:not(:disabled), .prson-btn:active { transform: none; }
}
`;

/**
 * Inject the stylesheet exactly once per page. Subsequent imports
 * (e.g. multi-tab dev tooling that ends up loading the bundle
 * twice) are no-ops thanks to the dedupe attribute.
 */
export function injectStylesOnce(): void {
  if (typeof document === "undefined") return;
  if (document.querySelector("style[data-prson-login-ui]")) return;
  const el = document.createElement("style");
  el.setAttribute("data-prson-login-ui", "1");
  el.textContent = PRSON_LOGIN_UI_CSS;
  // Append rather than prepend so partner-supplied stylesheets that
  // load earlier still win the cascade tie-break by default.
  document.head.append(el);
}
