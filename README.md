# @prson/login-sdk

> Frontend-first **sign-in / sign-up** SDK for any website. The user proves
> they're a real human (and optionally any attested fact) by presenting a
> Prson **SD-JWT-VC** from their mobile wallet, delivered to the browser
> over an end-to-end-encrypted WebRTC channel — never touching the
> website's backend until you choose to forward it.

Packages: [`@prson/login-sdk`](packages/browser) (browser),
[`@prson/login-sdk-ui`](packages/browser-ui) (button and QR),
[`@prson/login-verifier`](packages/verifier-node) (server checks) and
[`@prson/login-cli`](packages/cli-node) (command line). Apache-2.0.
This repository is mirrored from Prson's main repository, so some links in
the design documents point to server code that isn't public. Security
reports: security@yumankind.com (see [SECURITY.md](SECURITY.md)).

```ts
import { PrsonLogin } from "@prson/login-sdk";

const result = await PrsonLogin.signIn({
  domain: window.location.hostname,                // bound into the request
  required: {
    minVerificationLevel: 5,                       // weak < 5 ≤ strong
    requiredClaims: ["given_name"],                // standard SD-JWT-VC names
    predicates: ["age_gte_18"],                    // on-demand signed predicates
    identityType: "personal",                      // | "organization"
  },
  ttlMinutes: 2,                                   // capped at 2 today (see below)
  ui: { theme: "auto" },                           // the SDK's own dialog; or mountQrInto: "#el"
});

console.log(result.sdJwtVc);          // standard SD-JWT-VC presentation
console.log(result.prsonId);           // the person's Prson ID on your site (use as user id)
console.log(result.claims);            // decoded disclosed claims (sanity-check copy)
console.log(result.cnf.jwk);           // holder's Ed25519 public key (verify KB-JWT yourself)
console.log(result.session.expiresAt); // ms epoch — renew before this
```

That's it on the happy path. Everything below is the design surface
behind those four lines.

---

## Why this SDK exists

Every "sign in with X" widget you've ever embedded has the same shape:
the user authenticates against the IdP, the IdP redirects back with a
token, your backend exchanges it for a user record. Three round-trips,
two backend integrations (yours + the IdP), one universal source of
truth (the IdP's database).

**Prson inverts this.** There's no Prson account, no database we hold,
nothing for an attacker to phish. The user already holds a verifiable
credential signed by the Prson notary key (published as
[`did:web:app.prson.net`](https://app.prson.net/.well-known/did.json)).
At sign-in time:

- The **browser** generates an ephemeral X25519 keypair, registers a
  short-lived **draft** with Prson's Cloudflare Worker (anonymous,
  IP-rate-limited; no relay capacity allocated yet), opens a
  WebSocket back to that Worker, and renders a QR.
- The **mobile wallet** scans the QR. The user picks which claims to
  disclose; the wallet **signs a claim** with its Ed25519 identity
  key (proves consent to a real Prson user) and posts it to the
  Worker's `/session/claim`. The Worker verifies the signature, mints
  short-lived Cloudflare TURN credentials, and activates the relay.
- The wallet then builds an SD-JWT-VC presentation + a KB-JWT bound
  to the browser's origin + nonce, **encrypts** the envelope to the
  browser's ephemeral X25519 pk (NaCl `box`), and pushes it over the
  WebRTC data channel (direct peer-to-peer when possible, TURN-relayed
  on NAT fallback).
- The **browser** decrypts. Done. Prson's servers never see the
  credential payload — they only relay encrypted bytes, and only
  for sessions a wallet has actually signed for.

The credential is **standard SD-JWT-VC + standard Ed25519 KB-JWT**, so
any compliant verifier library (Sphereon, walt.id, EUDI ref, our
included Node example) verifies it without knowing anything about
Prson's wire format.

## What you're getting

Two-package monorepo:

```
login-sdk/
├── README.md                # ← you are here
├── ARCHITECTURE.md          # full wire-format + protocol spec
├── SECURITY.md              # threat model + crypto rationale
├── TRUST-CHAIN.md           # identity proof end-to-end + token design decisions
├── packages/
│   ├── browser/             # @prson/login-sdk        (this is the SDK)
│   │   ├── README.md
│   │   ├── package.json
│   │   └── src/
│   └── verifier-node/       # @prson/login-verifier   (reference verifier)
│       ├── README.md
│       ├── package.json
│       └── src/
└── examples/
    ├── plain-html/          # drop into any static site
    ├── next/                # Next.js App Router example
    └── express-verifier/    # tiny Node.js verifier that prints claims
```

## The four flows it supports

### 1. Cross-device (desktop → phone via QR + WebRTC)

The recommended default. The user is on their laptop, scans the QR
with their phone, gets signed in. No password, no email round-trip.

```
desktop browser            Cloudflare Worker            mobile wallet
┌─────────────┐            ┌────────────────┐           ┌────────────┐
│ generate    │            │ DRAFT ─60s──┐  │           │            │
│ ephemeral   │ POST       │              │  │           │            │
│ X25519 pk   │ /session/  │              │  │           │            │
│             │  draft  ──►│ DO[reqId]    │  │           │            │
│             │◄── {reqId, draftToken,    │  │           │            │
│             │     signalingWss}         │  │           │            │
│ open WS     │ wss        │              │  │           │            │
│ render QR ──┼──signal────┤              │  │           │ scan QR    │
│ (reqId,     │   (offer+  │              │  │           │            │
│  browserPk, │    ICE)    │              │  │           │            │
│  nonce,     │            │              │  │           │ user picks │
│  domain,    │            │              │  │           │ disclosures│
│  req)       │            │              ▼  │           │            │
│             │            │ Ed25519 ◄────┘  │ POST      │ sign claim │
│             │            │   verify  ◄─────┼─/session/─│ with       │
│             │            │ ACTIVE +        │   claim   │ identity   │
│             │            │ mint TURN       │           │ Ed25519 sk │
│             │            │ ──────────────► │           │            │
│             │            │              ◄──┼ wss WS    │ open WS    │
│             │◄─────────signal fan-out─────►│           │ answer+ICE │
│             │            │              │  │           │            │
│             │◄══════════ WebRTC P2P data channel ═════►│ NaCl-box   │
│             │             (TURN-relay fallback)        │ encrypt    │
│ decrypt     │            │              │  │           │            │
│ verify      │            │              │  │           │            │
│ → signed in │            │              │  │           │            │
└─────────────┘            └────────────────┘           └────────────┘
```

### 2. Same-device (mobile browser ↔ wallet on the same phone)

When the browser detects a touch-capable device + Prson wallet
installed, the QR is replaced by a "Sign in with Prson" button that
fires a universal / app link (`https://app.prson.net/login/v1?…`) into
the wallet (the old `prson://` scheme is no longer emitted). The wallet
returns to the browser through a universal-link callback OR, if the
browser doesn't support same-app return, through the same WebRTC
channel.

### 3. WebRTC fallback to HTTPS POST (OpenID4VP compatibility)

If a partner only speaks vanilla OpenID4VP cross-device, the SDK can
operate in **compat mode**: instead of a Prson-encrypted WebRTC
delivery, the wallet HTTPS POSTs the presentation to a `response_uri`.
The credential is unchanged; only the transport is. See
[ARCHITECTURE.md §3.4](./ARCHITECTURE.md).

### 4. CLI / terminal programs (QR or short code → your backend)

`mycli login` renders a QR (or a typeable short code) built by
[`@prson/login-cli`](./packages/cli-node/README.md); the user approves
on their phone and the wallet POSTs the presentation + signed
predicates to **your backend's** delivery-pinned HTTPS endpoint — the
same `/request/v1` wallet-action transport used for one-shot fact
requests, so no new trust surface. The CLI polls your backend (keyed
by the request nonce) and receives whatever session your backend mints
after verifying with `@prson/login-verifier`. Raw credentials never
touch the terminal.

## The default UI: button and sign-in dialog (`@prson/login-sdk-ui`)

Load the UI bundle next to the SDK and you get both pieces with no
configuration:

```html
<script type="module" src="prson-login-ui.js"></script>
<prson-signin-button id="signin" variant="amber" size="lg"></prson-signin-button>
<script type="module">
  import { PrsonLogin } from "./prson-login.js";
  document.querySelector("#signin").addEventListener("click", async () => {
    const result = await PrsonLogin.signIn({
      // A function: a refreshed code gets a fresh backend nonce. result.nonce says which one was used.
      nonce: async () => (await fetch("/auth/nonce", { method: "POST" }).then((r) => r.json())).nonce,
      required: { predicates: ["age_gte_18"], requiredClaims: ["given_name"] },
      // No ui.mountQrInto: the SDK's own dialog (recommended).
    });
  });
</script>
```

### The "Sign in with Prson" button

The Prson mark (the "p" on a rounded square) followed by "Sign in with
Prson" in Inter 600. Every variant and size is at least 44 px tall, with a
3 px focus ring and a 1 px press. Press and busy animations stop under
reduced motion.

| Variant | Looks like | Use on |
|---|---|---|
| `amber` (default) | Amber #FBBF24 fill, ink #0A0A0A text, ink square with an amber "p" | Light pages: the brand's primary action |
| `dark` | Ink fill, white text, amber square with an ink "p" | Light pages that want less colour |
| `light` | White fill, hairline border, ink text, amber mark | Dark or photographic backgrounds |
| `outline` | Transparent, 1.5 px border and text in the surrounding text colour, amber mark | Anywhere; it adapts to light and dark |

Sizes: `md` is 44 px with 15 px text, and `lg` is 52 px with 16 px text.
`full-width` stretches it to its container. `busy` makes the mark pulse
and sets `aria-busy`. `disabled` disables it. `label` changes the text,
for example to "Continue with Prson".

There are three ways to use it:

- **Custom element:** `<prson-signin-button variant="dark" size="lg">`. It renders a real `<button>` in the light DOM, so forms, focus and your CSS work as usual. Listen for `click` on the element.
- **From script:** `createSignInButton({ variant, size, label, fullWidth, onClick })` returns an `HTMLButtonElement`.
- **Plain HTML:** `<button class="prson-signin-btn prson-signin-btn--amber">` plus the markup from `prsonMarkSvg()`, styled by the injected stylesheet.

The developer console has a Vue version with the same design:
`prson-website/app/components/PrsonSignInButton.vue`.

### The sign-in dialog

`signIn()` without `ui.mountQrInto` opens an accessible dialog. It uses
`role="dialog"` and `aria-modal`, and is labelled "Sign in to <site>".
Focus moves into the dialog and stays there; when the dialog closes,
focus goes back to the page. Esc, a click outside or the close button
cancel the sign-in: `signIn()` then rejects with `LoginAbortedError`, or
with the error on screen if there was one. On screens up to 480 px wide
the dialog is a bottom sheet.

From top to bottom:

1. **Header:** the Prson mark, "Sign in with Prson" and a 44 px close button.
2. **The site:**
   - "Sign in to" over the domain in 24 px bold, for example **shop.example.com**.
   - A tinted square with the site's initial ("E") next to it. The same domain always gets the same tint.
   - The domain comes from the request inside the code, which is the domain the wallet signs.
3. **The code (computers):**
   - A large, always dark-on-white QR in a white rounded frame, with the Prson mark in the centre.
   - The frame's border is the countdown ring, an amber stroke that runs down over the code's lifetime (the Worker's 3-minute draft). It turns amber-600 for the last 30 seconds.
   - Under it: "Open Prson on your phone and scan this code." and "Code expires in 2:41".
4. **Phones:**
   - No QR. Instead, one full-width amber "Open Prson" button: the same universal link (`https://app.prson.net/login/v1?…`).
   - "Scan with another phone instead" reveals the code.
5. **What the site will get:** read from the code's own request, for example:
   - "Verified human"
   - "18 or older", with "Not your date of birth" under it
   - "Your name"
   - "A sign-in key just for this site"

   A unique-human request reads "Verified unique person · Passport or ID checked · not trackable across sites".
6. **Anti-relay cue:** a lock icon and "Only scan codes shown on **shop.example.com**. Never scan one someone sent you."
7. **Footer:** "Don't have Prson? Get the app" (`ui.getAppUrl`, default https://app.prson.net/).

Progress replaces the code with an overlay. Each step is announced
through an `aria-live` region:

| Step | What the dialog shows |
|---|---|
| Phone connected | A pulsing phone icon: the wallet claimed the code |
| Receiving your proof | The encrypted channel is open |
| Checking the proof | The SDK is verifying it |
| Signed in | An amber disc pops in, the check draws itself, and "You're signed in to shop.example.com". It holds for 1 s (0.45 s with reduced motion), then the dialog closes and `signIn()` resolves. |
| This code expired | "Get a new code" makes a new draft in place |
| Sign-in didn't finish | The reason in plain words, and "Try again" |

The wallet claims the code only when the person approves on the phone.
So "Phone connected" and the steps after it follow the approval; the
browser can't see the scan itself.

Theme: `ui.theme` is `"auto"` (follows `prefers-color-scheme`),
`"light"` or `"dark"`. Light is the brand's primary look; dark uses
zinc-900 surfaces with amber accents. The QR stays dark on white in every
theme. You can override the colours with `--prson-*` custom properties on
`[data-prson-login-ui]`.

Nothing on the dialog can usefully be copied: the code is single-use,
bound to this browser's ephemeral key and expires in minutes. The URL is
never printed or offered for copying on a computer.

**Compatibility:**

- The 0.1 renderer contract still works: `window.__prsonLoginQrRenderer(url, mount, theme)` returning `{ dispose }`.
- New renderers get a fourth `context` argument (`mode`, `domain`, `refresh`, `cancel`, `getAppUrl`, `titleId`) and may return `update(state)`.
- With `ui.mountQrInto`, the card renders inline as before. The bubbling `prson-login-refresh-requested` event still fires on "Get a new code". If the page doesn't call `signIn()` again from it, the SDK refreshes the code itself.

## Sessions, renewal, revocation

SD-JWT-VC presentations are **short-lived by design**. Today the SDK
caps sessions at 2 minutes (`DEFAULT_TTL_MINUTES` = `MAX_TTL_MINUTES` =
2 in `packages/browser/src/index.ts`, matching the signaling Worker's
`SESSION_TTL_SECONDS`) so expiry and renewal are exercised often; the
production target is a 10-minute default and 15-minute maximum. The session keeps living on
your site as long as the wallet keeps pushing renewals.

```ts
const session = result.session;
session.onExpiry((reason) => {
  // reason: "wallet_signed_out" | "ttl_reached" | "user_revoked" |
  //         "network_loss" | "credential_revoked"
  signUserOut();
});
session.onRenewed((freshCredential) => {
  // The wallet pushed a new SD-JWT-VC. The SDK has already verified
  // its KB-JWT (against the same cnf.jwk that signed the original).
  console.log("session extended to", freshCredential.expiresAt);
});
```

Renewals are **wallet-initiated**: the mobile UI shows an "Active web
sessions" tile per identity with a TTL countdown; tapping it pushes a
fresh credential. The SDK never asks for a renewal — the user
explicitly grants extension each cycle. About a minute before expiry,
the mobile app fires a local notification asking the user if they
want to renew (ignoring the notification = letting the session lapse
= signed out).

Revocation also flows wallet → website: a "Sign out everywhere"
action on the mobile app tears down all active sessions instantly by
sending a `revoke` envelope over the WebRTC data channel.

## Versioning + stability

| Component                                  | Stability                |
|--------------------------------------------|--------------------------|
| Credential format (SD-JWT-VC, RS256, did:web:app.prson.net) | **Stable** (IETF draft) |
| KB-JWT format (Ed25519, sd_hash bind)      | **Stable** (IETF draft) |
| WebRTC payload schema                      | Versioned in payload (`prson_vp_v1`) — see [ARCHITECTURE.md §4](./ARCHITECTURE.md) |
| Browser SDK API                            | SemVer; **0.x = breaking changes possible** until 1.0 |
| Verifier package                           | SemVer; **0.x = breaking changes possible** until 1.0 |

## License

Apache License 2.0 (see [`LICENSE`](LICENSE)); each package ships its
own copy. Copyright Yumankind OÜ.

## Where to go next

| If you want to… | Read |
|---|---|
| Integrate into a website in 5 minutes | [`packages/browser/README.md`](./packages/browser/README.md) |
| Run a verifier in your backend | [`packages/verifier-node/README.md`](./packages/verifier-node/README.md) |
| Add "Sign in with Prson" to a CLI tool | [`packages/cli-node/README.md`](./packages/cli-node/README.md) |
| Understand the wire formats | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| Audit the crypto / threat model | [`SECURITY.md`](./SECURITY.md) |
| Understand how identity is proven (and why the HMAC token doesn't gate identity) | [`TRUST-CHAIN.md`](./TRUST-CHAIN.md) |
| See what's coming (events, on-demand signing) | [`ROADMAP.md`](./ROADMAP.md) |
| See a working end-to-end example | [`examples/plain-html/`](./examples/plain-html/) |
