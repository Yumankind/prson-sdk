# @prson/login-sdk

> Frontend-first **sign-in / sign-up** SDK for any website. The user proves
> they're a real human (and optionally any attested fact) by presenting a
> Prson **SD-JWT-VC** from their mobile wallet, delivered to the browser
> over an end-to-end-encrypted WebRTC channel — never touching the
> website's backend until you choose to forward it.

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
  ttlMinutes: 10,                                  // 1..15 — credential lifetime
  ui: { mountQrInto: "#prson-login-qr" },          // any DOM ref
});

console.log(result.sdJwtVc);          // standard SD-JWT-VC presentation
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
fires a deep link (`prson://login?…`) into the wallet. The wallet
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

## Sessions, renewal, revocation

SD-JWT-VC presentations are **short-lived by design** — the SDK
enforces 1-15 min TTL, default 10 min. The session keeps living on
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

TBD by Prson. The verifier package is intended to be permissive
(MIT-class) so it ships into third-party backends without friction.
The browser SDK same.

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
