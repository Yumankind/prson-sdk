/**
 * CSS bundled with the UI package and injected at import-time via a
 * single `<style data-prson-login-ui>` tag.
 *
 * Embedding the stylesheet in JS rather than shipping a sidecar
 * `.css` file is deliberate — the goal of `@prson/login-sdk-ui` is
 * "drop one script tag and get a working QR card". A separate
 * stylesheet adds a second HTTP fetch + a partner-side concatenation
 * step we don't want for a 7 KB stylesheet.
 *
 * The selectors live under `[data-prson-login-ui]` to make
 * partner-side overrides predictable: anything they target with
 * higher specificity wins, and they can scope their overrides to
 * the same attribute namespace.
 *
 * The CSS itself is the same one previously embedded in the
 * `examples/plain-html/index.html` <style> block, so the visual
 * output is unchanged.
 */

export const PRSON_LOGIN_UI_CSS = `
[data-prson-login-ui] {
  --prson-ui-bg: #fafafa;
  --prson-ui-fg: #111;
  --prson-ui-muted: #6b7280;
  --prson-ui-card: #ffffff;
  --prson-ui-border: rgba(0, 0, 0, 0.08);
  --prson-ui-shadow: 0 8px 24px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.05);
  --prson-ui-accent: #111;
  --prson-ui-radius: 16px;
}
@media (prefers-color-scheme: dark) {
  [data-prson-login-ui] {
    --prson-ui-bg: #0b0b0c;
    --prson-ui-fg: #f5f5f7;
    --prson-ui-muted: #9ca3af;
    --prson-ui-card: #18181b;
    --prson-ui-border: rgba(255, 255, 255, 0.08);
    --prson-ui-shadow: 0 8px 24px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.4);
    --prson-ui-accent: #f5f5f7;
  }
}

.prson-qr-card {
  background: var(--prson-ui-card);
  border: 1px solid var(--prson-ui-border);
  border-radius: var(--prson-ui-radius);
  box-shadow: var(--prson-ui-shadow);
  padding: 24px;
  margin-top: 28px;
  width: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: var(--prson-ui-fg);
  font-family: -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
  animation: prson-fade-up 220ms ease-out;
}
@keyframes prson-fade-up {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}
.prson-qr-card-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
}
.prson-qr-card-title {
  font-weight: 600;
  font-size: 15px;
  letter-spacing: -0.2px;
}
.prson-qr-card-subtitle {
  font-size: 12.5px;
  color: var(--prson-ui-muted);
  line-height: 1.45;
}
.prson-qr-frame {
  position: relative;
  padding: 14px;
  border-radius: 12px;
  background: #ffffff; /* always-white for camera contrast */
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.04);
  transition: opacity 0.2s ease;
}
.prson-qr-frame svg {
  display: block;
  width: 240px;
  height: 240px;
}
.prson-qr-foot {
  font-size: 11.5px;
  color: var(--prson-ui-muted);
  line-height: 1.4;
  text-align: center;
  max-width: 260px;
}
.prson-qr-foot a {
  color: var(--prson-ui-fg);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.prson-qr-countdown {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.prson-qr-countdown-label {
  font-size: 11.5px;
  color: var(--prson-ui-muted);
  letter-spacing: 0.2px;
  font-variant-numeric: tabular-nums;
}
.prson-qr-countdown-track {
  width: 100%;
  height: 3px;
  background: var(--prson-ui-border);
  border-radius: 2px;
  overflow: hidden;
}
.prson-qr-countdown-fill {
  height: 100%;
  background: var(--prson-ui-accent);
  width: 100%;
  transform-origin: left center;
  transition: transform 1s linear, background-color 0.3s ease;
}
.prson-qr-countdown[data-state="warn"] .prson-qr-countdown-fill { background: #e07b00; }
.prson-qr-countdown[data-state="warn"] .prson-qr-countdown-label { color: #e07b00; }
.prson-qr-countdown[data-state="expired"] .prson-qr-countdown-fill { background: #b02a2a; }
.prson-qr-countdown[data-state="expired"] .prson-qr-countdown-label { color: #b02a2a; }

.prson-qr-card[data-expired="1"] .prson-qr-frame {
  opacity: 0.35;
  filter: grayscale(1);
}
.prson-qr-refresh {
  font-size: 13px;
  font-weight: 500;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--prson-ui-border);
  background: var(--prson-ui-card);
  color: var(--prson-ui-fg);
  cursor: pointer;
  margin-top: 2px;
  font-family: inherit;
}
.prson-qr-refresh:hover { background: var(--prson-ui-bg); }
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
