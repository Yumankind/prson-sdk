# @prson/login-sdk-ui

Optional batteries-included UI for [`@prson/login-sdk`](../browser). One
script tag drops in a styled, themable QR card with a TTL countdown and
a refresh affordance. If your site already has a design system, you can
skip this package entirely — the base SDK is headless and accepts any
QR renderer you wire onto `window.__prsonLoginQrRenderer`.

## Install

Install from npm (below), or load the browser bundle from
`https://prson.net/vendor/prson-login/prson-login-ui.js` together with
`https://prson.net/vendor/prson-login/prson-login.js`.

Via npm:

```bash
npm install @prson/login-sdk @prson/login-sdk-ui
```

Via `<script>`:

```html
<script type="module" src="https://prson.net/vendor/prson-login/prson-login.js"></script>
<script type="module" src="https://prson.net/vendor/prson-login/prson-login-ui.js"></script>
```

## Use

The package is a **side-effect import**. Loading it once registers a
renderer on `window.__prsonLoginQrRenderer`; the base SDK reads that
global when `PrsonLogin.signIn(...)` needs to draw a QR.

```ts
import "@prson/login-sdk-ui";              // ← side-effect register
import { PrsonLogin } from "@prson/login-sdk";

await PrsonLogin.signIn({
  ui: { mountQrInto: "#prson-login-qr", theme: "auto" },
  required: { minVerificationLevel: 5 },
});
```

That's it. No further configuration. The card renders, the TTL counts
down, and when it expires the footer swaps to a **Generate a new code**
button.

## Refresh contract

When the TTL hits zero the refresh button dispatches a bubbling
`CustomEvent` named `prson-login-refresh-requested` on the document.
Listen for it and re-trigger your sign-in flow:

```ts
document.addEventListener("prson-login-refresh-requested", () => {
  document.querySelector("#signin")?.click();
});
```

## Manual / opt-out

If you want the renderer but NOT the auto-registration (e.g. you want
to mount conditionally, or wrap it in your own logic):

```ts
import { renderQrCard } from "@prson/login-sdk-ui/render";

// Don't import the package's main entry — only the manual one.
window.__prsonLoginQrRenderer = (url, mount, theme) => {
  // ... your own conditional logic, then:
  return renderQrCard(url, mount, theme);
};
```

## Theming

The card scopes its CSS variables to `[data-prson-login-ui]`. Override
any of them with higher specificity to match your design system:

```css
[data-prson-login-ui] {
  --prson-ui-card: oklch(0.97 0.02 250);
  --prson-ui-accent: oklch(0.5 0.2 250);
  --prson-ui-radius: 20px;
}
```

Full variable list lives in [`src/styles.ts`](src/styles.ts).

## What it weighs

- Bundle size: **~70 KB** uncompressed, ~22 KB gzipped. The
  `qrcode` library accounts for the bulk; the renderer + styles are
  ~7 KB combined.
- Runtime cost: one SVG draw + a 1 Hz `setInterval` while the QR is
  on-screen.

## Building

```bash
cd login-sdk/packages/browser-ui
npm install
npm run build           # → dist/index.js  (publishable artefact)
npm run build:example   # → ../../examples/plain-html/prson-login-ui.js
```

`npm run build:vendor` in `login-sdk/` rebuilds every committed bundle
(the plain-HTML demo and the minified copies served from
`prson.net/vendor/prson-login/`); CI fails the deploy if they are stale
(`npm run check:vendor`).

Editing `src/qr-renderer.ts` or `src/styles.ts` and re-running
`npm run build:example` picks up in the plain-HTML demo without any
other moving parts.
