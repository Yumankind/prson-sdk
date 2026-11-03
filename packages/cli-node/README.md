# @prson/login-cli

Sign in with Prson from **terminal programs** — `mycli login` shows a
QR code (or a short code), the user approves on their phone, and your
CLI gets a session from your backend. No password, no copy-pasted API
key, and the same verified-human / predicate guarantees as a web
sign-in (including predicates like `age_gte_18` or
`email_domain_academic`).

It reuses the audited **sessionless wallet-action transport**
(`/request/v1` links with delivery pinning) end-to-end: there is no
new server surface, no signaling session, and the CLI never sees raw
credentials — the wallet delivers them only to your domain's HTTPS
endpoint, exactly like every other Prson flow.

```
terminal (CLI)            user's phone (wallet)        your backend
┌──────────────┐          ┌───────────────────┐        ┌─────────────────┐
│ build pinned │          │                   │        │                 │
│ /request/v1  │          │                   │        │                 │
│ link + nonce │          │                   │        │                 │
│ render QR ───┼─ scan ──►│ consent screen    │        │                 │
│              │          │ (shows YOUR       │        │                 │
│ poll backend │          │  domain, anti-    │        │                 │
│ by nonce ────┼────────► │  phishing render) │        │                 │
│      ▲       │          │ user approves     │        │                 │
│      │       │          │ POST presentation ┼──────► │ verify with     │
│      │       │          │ + signed facts to │        │ @prson/login-   │
│      │       │          │ responseUrl       │        │ verifier, mint  │
│      └───────┼──────────┼───────────────────┼─────── │ session token   │
│ session! 🎉  │          │ (pinned to your   │        │                 │
└──────────────┘          │  domain — wallet  │        └─────────────────┘
                          │  refuses others)  │
                          └───────────────────┘
```

## Install

```bash
npm install @prson/login-cli
```

Node 20 or later. This package is Node-only and has no browser bundle.

```bash
npm install @prson/login-cli
```

## Why this is safe for a terminal

A CLI has no browser Origin, so the web login's origin-pinning can't
apply. Instead this flow inherits the wallet-action trust model:

- **The user approves a domain they can read.** The wallet consent
  screen renders your domain with the same monospace, never-truncated,
  homoglyph-highlighting display as web login.
- **Delivery is pinned.** The wallet only POSTs the result to an HTTPS
  endpoint whose host **equals** that domain (port 443). A tampered QR
  that names your domain but points elsewhere is refused by the wallet
  before consent.
- **The CLI is outside the trust boundary.** It only ever holds the
  random `nonce` and whatever your backend chooses to return (a
  session token). Verification of the presentation, KB-JWT audience,
  nonce and predicate signatures happens in your backend with
  [`@prson/login-verifier`](../verifier-node/README.md).

Like every cross-device flow (incl. RFC 8628 device codes), the QR
itself doesn't prove which terminal initiated it — the consent screen
therefore tells the user exactly what they're approving and for which
domain. Show the `userCode` in the terminal and on your status page so
support can correlate sessions.

## CLI side

```ts
import { startCliLogin } from "@prson/login-cli";

const login = await startCliLogin({
  domain: "example.com",
  responseUrl: "https://example.com/api/prson/cli-callback",
  required: {
    minVerificationLevel: 4,
    predicates: ["age_gte_18"],
    uniqueHumanId: true,            // stable sybil-resistant id, scoped to your domain
  },
});

console.log("Scan with the Prson app:\n");
console.log(login.qr);
console.log(`...or open  https://example.com/cli/${login.userCode}  on your phone\n`);

// Poll YOUR backend (keyed by the nonce) until the wallet response landed.
const session = await login.wait(async () => {
  const res = await fetch(
    `https://example.com/api/prson/cli-status?nonce=${encodeURIComponent(login.nonce)}`
  );
  if (res.status === 404) return null;          // still pending
  return (await res.json()).sessionToken;        // whatever your backend mints
});

console.log("Signed in!");
```

`startCliLogin` = `createFactsRequest` (build + validate the link) +
`renderQr` (ANSI half-block QR) + `pollForResponse` (interval/timeout/
abort handling). Use the granular functions if you want different
output (e.g. print the URL over SSH instead of a QR).

### The short-code alternative ("or a code")

`login.userCode` is a stable 8-char Crockford code derived from the
nonce (`K7QF-3DPN`). If you serve a tiny redirect on your domain —

```
GET https://example.com/cli/K7QF-3DPN  →  302 Location: <login.url>
```

— the user can type that URL on their phone instead of scanning the
QR. The redirect lives on **your** backend (one route + a TTL'd map of
code → URL registered when the CLI starts the login); Prson
infrastructure is unchanged, and the wallet still validates the full
pinned request after the redirect.

## Backend side

Two routes plus a TTL'd pending-login store (Redis, DB, in-memory):

```ts
import {
  verifyPresentation,
  verifySignedFragment,
} from "@prson/login-verifier";

// 1. The wallet's delivery endpoint (the `responseUrl` in the CLI).
app.post("/api/prson/cli-callback", async (req, res) => {
  const { nonce, presentation, facts } = req.body; // action: "request"
  const pending = await pendingLogins.get(nonce);
  if (!pending) return res.status(404).end();

  const result = await verifyPresentation(presentation, {
    expectedAudience: "https://example.com",
    expectedNonce: nonce,
  });
  if (!result.ok) return res.status(400).json({ error: result.reason });

  for (const fact of facts?.facts ?? []) {
    const v = await verifySignedFragment(fact.credential, {
      expectedAudience: "example.com",
    });
    if (!v.ok || fact.value !== true) return res.status(400).end();
  }

  // Authenticated! cnf.jwk is the user's stable per-YOUR-domain key.
  const sessionToken = await mintSession(result.cnf.jwk, result.claims);
  await pendingLogins.complete(nonce, sessionToken);
  res.status(204).end();
});

// 2. What the CLI polls.
app.get("/api/prson/cli-status", async (req, res) => {
  const done = await pendingLogins.result(String(req.query.nonce));
  if (!done) return res.status(404).end();
  res.json({ sessionToken: done });
});
```

Treat `nonce` as a bearer secret for the pending login: deliver the
session token to the poller once, then delete the record. Expire
pending logins after ~5 minutes (the poller default).

## API

| Export | What it does |
|---|---|
| `startCliLogin(opts)` | One-shot: build + QR + `wait()` poller handle. |
| `createFactsRequest(opts)` | Build & validate the `/request/v1` link (`{url, nonce, userCode, req}`). Throws on anything the wallet would refuse. |
| `renderQr(url, {small})` | ANSI QR string for terminals. |
| `pollForResponse(check, {intervalMs, timeoutMs, signal})` | Generic poller: resolves on first non-null `check()`. |
| `userCodeFromNonce(nonce)` | The `XXXX-XXXX` short code. |

Requires Node ≥ 18. Single runtime dependency: `qrcode-terminal`.

## Not using Node?

The CLI side is four steps any language can do (the package is just a
convenience). See [PROTOCOL.md](./PROTOCOL.md) for the wire format,
the validation rules to mirror, and ready-to-paste examples in
**Python, Go, Rust and Bash**.
