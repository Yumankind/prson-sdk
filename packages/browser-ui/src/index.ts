/**
 * `@prson/login-sdk-ui` — optional batteries-included UI for the
 * sign-in-with-Prson flow.
 *
 * What this package is for
 * ------------------------
 * The base SDK (`@prson/login-sdk`) is intentionally headless: it
 * does the crypto, talks to the signaling Worker, and delegates QR
 * rendering to whatever the host page assigns to
 * `window.__prsonLoginQrRenderer`. That keeps the base bundle
 * small (~25 KB gzipped) and lets enterprise partners drop their
 * own design-system QR card in.
 *
 * This companion package is the opposite end: import it once and
 * you get a styled QR card with a TTL countdown + refresh
 * affordance — zero configuration. Partners can use it on a demo
 * site or for a quick deployment; production deployments that
 * already have a design system can either keep using it (the card
 * is themeable via CSS variables under `[data-prson-login-ui]`) or
 * skip it entirely.
 *
 * Usage
 * -----
 * Via `<script>`:
 *
 *     <script type="module" src="path/to/prson-login.js"></script>
 *     <script type="module" src="path/to/prson-login-ui.js"></script>
 *     <!-- now signIn() uses the styled card by default -->
 *
 * Via npm:
 *
 *     import "@prson/login-sdk-ui";              // side-effect register
 *     import { PrsonLogin } from "@prson/login-sdk";
 *     await PrsonLogin.signIn({ ... });
 *
 * If you want to opt out of just the auto-registration but still use
 * the renderer manually:
 *
 *     import { renderQrCard } from "@prson/login-sdk-ui/render";
 *     window.__prsonLoginQrRenderer = renderQrCard;
 *
 * Refresh contract
 * ----------------
 * When the QR's TTL expires, the card swaps to a "Generate a new
 * code" button. Clicking it dispatches a bubbling `CustomEvent`
 * called `prson-login-refresh-requested` so the host page can
 * decide what to do — most callers want to re-invoke `signIn()`.
 * Example listener:
 *
 *     document.addEventListener("prson-login-refresh-requested", () => {
 *       document.querySelector("#signin")?.click();
 *     });
 */

import {
  renderQrCard,
  type LoginQrContext,
  type LoginQrHandle,
  type LoginUiState,
  type Theme,
} from "./qr-renderer.js";
import { injectStylesOnce } from "./styles.js";
import { defineSignInButtonElement } from "./button.js";

// Re-export the manual entry-points so callers who want to opt out
// of the auto-registration can still use the renderer themselves.
export { renderQrCard };
export type { LoginQrContext, LoginQrHandle, LoginUiState, Theme };
export { PRSON_LOGIN_UI_CSS, injectStylesOnce } from "./styles.js";
// The "Sign in with Prson" button (see button.ts and ../../README.md).
export {
  createSignInButton,
  defineSignInButtonElement,
  prsonMarkSvg,
  type SignInButtonOptions,
  type SignInButtonSize,
  type SignInButtonVariant,
} from "./button.js";
export { describeCode, describeShares, monogram, type CodeDescription, type ShareItem } from "./describe.js";

// ─── Side-effect registration ───────────────────────────────────────
//
// Run on import in a browser context. Two effects:
//   1. Inject the stylesheet once (idempotent — see styles.ts).
//   2. Register the renderer on the global the base SDK reads at
//      signIn-time.
//
// Both gated by `typeof window !== "undefined"` so this file is
// safe to import in a non-browser context (e.g. SSR / Node test
// runners loading the entry to type-check exports).
if (typeof window !== "undefined") {
  injectStylesOnce();
  (
    window as unknown as {
      __prsonLoginQrRenderer?: (
        url: string,
        mount: HTMLElement,
        theme: Theme,
        context?: LoginQrContext,
      ) => LoginQrHandle;
    }
  ).__prsonLoginQrRenderer = renderQrCard;
  // <prson-signin-button>
  defineSignInButtonElement();
}
