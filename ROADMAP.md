# Roadmap — Prson Login SDK

> Features documented here are **deliberately not built yet**. Each
> section is a contract: the API shape is committed, the wire format
> is sketched, the security model is mapped to existing primitives.
> When we implement, we follow this doc; if the doc disagrees with
> the code, the doc is wrong and gets a versioned bump.
>
> Read alongside [`ARCHITECTURE.md`](./ARCHITECTURE.md) and
> [`SECURITY.md`](./SECURITY.md). Anything here that lands moves into
> those documents at implementation time; this file is the staging
> area.

---

## 1. SDK lifecycle events

> **Status: shipped (SDK + wallet sides).** The browser SDK emits
> the full [`LoginEvent`](packages/browser/src/session.ts) union
> via `session.on(type, cb)` / `session.onAny(cb)`; the wallet
> emits `display-update` and `credential-revoked` envelopes
> automatically from the
> [`ActiveSessionEventBridge`](../mobile-app/prson_app/lib/core/services/login/active_session_event_bridge.dart)
> when the bound identity changes. **§1.5 (request channel) is
> also shipped** — `session.request(...)` opens a verifier→wallet
> bidirectional surface for claim-value asks, fragment checks,
> document presence/sign, and HTML5-style input prompts.
> Wallet-side `claim-update` re-mint is the one piece still TODO
> (the SDK accepts the envelope; the bridge logs a
> `TODO(prson-login-events)` line when a re-mint would fire and
> the host falls back to renewal-on-TTL).

**Goal**: let host sites react to wallet-side changes *after* sign-in
without polling. Today the SDK exposes `session.onRenewed()` and
`session.onExpiry()`; we'll widen that to a richer event stream so
the host can keep its own UI in sync with what the wallet says.

### 1.1 Proposed event taxonomy

```ts
type LoginEvent =
  // Identity lifecycle
  | { type: "signed_in";   result: SignInResult }
  | { type: "signed_out";  reason: ExpiryReason }
  | { type: "renewed";     result: SignInResult }

  // Profile / claim updates pushed by the wallet during an active
  // session, without forcing a full re-sign-in cycle. The wallet
  // emits these when the underlying source changes.
  //
  // Privacy: events are NAME-ONLY. The verified value lands in
  // `session.claims[name]` after the SDK re-verifies the fresh VC
  // bundled with the envelope; the event payload itself never
  // carries the value. This keeps raw identity data out of
  // `onAny` telemetry surfaces (loggers, analytics pipes,
  // crash reporters).
  | { type: "claim_added";    name: string }
  | { type: "claim_removed";  name: string }
  | { type: "claim_updated";  name: string }

  // Display-only updates. Don't carry crypto material; just hints
  // for the host to refresh its UI. The wallet decides whether to
  // include these in the channel (user can disable from the active-
  // sessions tile if a domain shouldn't see live updates).
  //
  // These DO carry values — they're explicitly public (the user
  // chose to expose them), and the host needs them to update
  // cosmetic UI without a second read step.
  | { type: "display_name_changed"; displayName: string | null }
  | { type: "avatar_changed";       avatar: { url: string; hash: string } | null }

  // Compliance / status updates from the issuer (notary) side.
  | { type: "credential_revoked";   reason: "alias_transferred" | "user_revoked" | "key_compromised" };
```

> **Why name-only for claim events?** `onAny` is the natural
> attachment point for telemetry (analytics, error reporters,
> ML feature pipelines, …). Any of those trivially capture entire
> event objects. Putting `value` into the event payload would
> silently leak raw identity data — name, birthdate, verification
> level — through every such pipe without the host owner
> noticing. Name-only events let telemetry log **that** a claim
> changed without ever seeing **what** it changed to. The host
> reads `session.claims[name]` when (and only when) it needs the
> value, and that read site becomes the explicit, auditable point
> where claim values cross from the SDK into host code.

### 1.2 Wire integration

All non-sign-in events flow on the same WebRTC data channel the
session already owns. They use the same NaCl-boxed envelope shape,
with `envelope.msg` extended:

```
envelope.msg ∈ {
  "presentation",     // existing — full SD-JWT-VC delivery (initial + renewals)
  "revoke",            // existing — wallet-side sign-out
  "claim-update",      // NEW: { presentation, delta?: { added/removed/updated: string[] } }
  "display-update",    // NEW: { displayName?, avatar? }
  "credential-revoked" // NEW: { reason }
}
```

> **`claim-update` payload constraints (wire grammar):** the
> wallet MUST send the freshly-minted SD-JWT-VC presentation in
> `envelope.presentation` — that's the only place claim values
> are allowed to travel. The optional `delta` field is **name-only**
> (lists of changed claim names). The browser SDK ignores `delta`
> as a security input — it always recomputes the diff from the
> re-verified VC — and emits name-only events to the host. A
> wallet that includes values inside `delta` violates the
> protocol; the SDK won't error on it, but it will also never
> trust or propagate those values.

The host subscribes via:

```ts
session.on("claim_updated", (e) => {
  // Event payload is name-only. Read the current value from the
  // session's verified-claims snapshot when you need it.
  if (e.name === "verification_level") {
    refreshTrustBadge(session.claims.verification_level);
  }
});
session.on("avatar_changed", (e) => {
  // Display events carry their values directly — explicitly
  // public, meant for cosmetic UI.
  navAvatar.src = e.avatar?.url ?? defaultAvatarUrl;
});
```

### 1.3 What the verifier still has to do

Every event that carries new claims (`claim_added`, `claim_updated`,
`renewed`) MUST be backed by a fresh SD-JWT-VC presentation that
re-verifies under the rules in [`SECURITY.md` §7](./SECURITY.md). The
host site shouldn't trust the bare event payload — it should pull
`session.currentSdJwt` (or the freshest one delivered by `renewed`)
through `@prson/login-verifier` before honouring the update.

### 1.4 Privacy controls (wallet side)

The active-sessions tile on the mobile app gains a per-domain
"Live updates" toggle. Default ON for the duration of the session,
OFF after the session expires (no background updates without an
active session). Per-domain because the user might want a banking
site to never see avatar changes but a chat site to track them.

### 1.5 Verifier → wallet request channel

A bidirectional surface layered on the existing WebRTC data
channel. The host site sends a `request` envelope; the wallet
shows a bottom drawer to the user; the user's choice is encoded
as a `response` envelope back through the same channel, paired by
UUID.

```ts
type LoginRequest =
  | { kind: "claim-value"; name: string; reason?: string }
  | { kind: "fragment-check"; fragmentName: string; reason?: string }
  | { kind: "document-presence"; type?: string; country?: string; reason?: string }
  | {
      kind: "document-sign";
      document: { bytes: Uint8Array } | { uploadUrl: string; size?: number; sha256?: string };
      visibleCue?: string;
      reason?: string;
    }
  | {
      kind: "input";
      inputType:
        | "text" | "search" | "email" | "tel" | "url"
        | "number" | "password" | "select";
      label: string; placeholder?: string; defaultValue?: string;
      minLength?: number; maxLength?: number;
      min?: number; max?: number;
      pattern?: string; required?: boolean;
      options?: { value: string; label?: string }[]; // required when inputType === "select"
      reason?: string;
    }
  | {
      // Multi-field "kiosk form" — one wallet drawer, Prev / Next /
      // Send navigation, fills every field on Send. The reply is a
      // `Record<fieldName, string>`.
      kind: "input-form";
      fields: InputFormField[];
      submitLabel?: string;
      reason?: string;
    }
  | {
      // Virtual mouse — turn the phone into a touchpad or a gyro-
      // driven magic wand. The wallet streams pointer events as
      // `mouse-update` envelopes paired by `requestId` until the
      // user closes the drawer (which fires the terminating
      // `response`).
      kind: "mouse";
      mode: "touch" | "magic";
      reason?: string;
    };

type LoginResponse =
  | { ok: true; value: unknown }
  | { ok: false; error:
      "declined" | "not-present" | "expired" | "rate-limited" |
      "queue-full" | "no-active-session" | "timeout" | "session-closed" |
      "unsupported" | string };

session.request(req: LoginRequest, opts?: { timeoutMs?: number }): Promise<LoginResponse>;
```

#### Protocol invariants

1. **One request per second** on the wallet side. Inbound
   envelopes arriving inside the throttle window are dropped
   silently — the host's per-call timeout (default 60 s)
   surfaces them as `error: "timeout"`.
2. **Max five outstanding requests** queued on the wallet at
   any time. Further envelopes are dropped silently. The cap
   releases by one as soon as the user responds (we free the
   slot before sending the `response`).
3. **Session-scoped lifetime.** No request fires before
   `signed_in`; no request flows while no session is active.
   Session teardown rejects every in-flight request with
   `error: "session-closed"`.
4. **End-to-end encrypted.** The wallet mints a session-long
   X25519 keypair at sign-in and publishes its public key on
   the initial `presentation` envelope (`walletSessionPk`); the
   browser SDK NaCl-boxes every outbound request to it. Forward
   secrecy per message via a fresh ephemeral pk in the
   envelope, same as the existing wallet → browser direction.

#### Wallet UX

A bottom drawer per accepted request, showing the verifier
domain, the request kind + parameters, and Approve / Decline.
Per-kind rich pickers (fragment selector with NFC fallback to
scan a fresh document, keyboard-aware input form with HTML5
validation, document signer with visible-cue placement) are
follow-ups; the v1 drawer surfaces a stubbed approval payload so
the protocol round-trips end-to-end.

#### Use cases this unlocks

- **Kiosk text entry.** "Enter your email on your phone": kiosk
  fires `kind: "input", inputType: "email"`, wallet shows a
  keyboard sized to the constraints, returns the typed value.
- **Late-binding fact checks.** "Are you a citizen of country
  X?": `kind: "fragment-check"`, wallet returns the signed
  fragment; verifier re-checks server-side.
- **Document signature.** PDF byte buffer or short-lived
  upload URL → wallet PAdES-signs with the identity's EC key.
- **DOM-bound form fill.** `bindInput(session, <input>)` and
  `bindForm(session, <form>)` synthesise an `input` / `input-form`
  request from the page's existing markup and write the wallet's
  reply back into the elements + fire `input` / `change` /
  `requestSubmit()` so reactive frameworks pick up the changes.
- **Phone as cursor.** `bindMouse(session, { mode: "touch" })` opens
  a virtual circular cursor on the page; the phone is a touchpad
  (drag = move, tap = click, two-finger drag = scroll). `mode:
  "magic"` swaps to a gyro-driven wand.
- **Remote navigation banner (QR mode).** `signIn({ remoteNavigation:
  true })` + `enableRemoteNavigation(session)` surface a persistent
  banner in the wallet with Prev / Next / Submit / Logout buttons
  (semantically Shift+Tab / Tab / Enter / `session.close()`). On
  focus the page pushes the current input value to the wallet, the
  user edits on the phone keyboard, and edits stream back via the
  `value` envelope. Mouse buttons live in the same drawer but stay
  disabled until the site opens a `kind: "mouse"` request. Wire
  grammar: outbound `focus` envelope from the browser; inbound
  `nav`, `value`, `logout` from the wallet.
- **Stale-claim refresh.** "What's your current verification
  level?": `kind: "claim-value"` returns the live value
  without a full re-sign-in.

---

## 2. Document signing on demand

**Goal**: let a logged-in website ask the user to sign a document
without a separate flow. Reuses the existing PAdES infrastructure
([`mobile-app/prson_app/docs/identity_pdf_signing.md`](../mobile-app/prson_app/docs/identity_pdf_signing.md))
end-to-end — the only new piece is the SDK-side trigger.

### 2.1 Pre-condition: the user has a signing certificate

The mobile wallet emits an EC P-256 signing certificate when the
identity reaches L5/6 (see `project_identity_pdf_signing` memory).
The SDK exposes this state as a getter on the session:

```ts
session.canSignDocuments(): boolean
// true iff the holder identity carries an active signing cert
// (verified at sign-in by inspecting the VC's metadata).
```

### 2.2 Proposed API

```ts
type SignRequest = {
  /** Display name shown to the user in the wallet's signing sheet. */
  documentName: string;

  /** Either: the document bytes (≤ 200 KB; SDK uploads), OR a
   *  pre-signed temp URL on the website's own storage. The wallet
   *  pulls from the URL, signs in place on the device (the doc
   *  never crosses Prson infrastructure). */
  source:
    | { kind: "inline"; bytes: ArrayBuffer; mime: "application/pdf" }
    | { kind: "url";    fetchUrl: string;   uploadUrl: string };

  /** Optional human reason; surfaces in the wallet drawer. */
  reason?: string;

  /** Optional signing-style hints — visible cue placement etc. */
  appearance?: {
    page?: number;
    rect?: { x: number; y: number; w: number; h: number };
  };
};

type SignResult =
  | { ok: true;  signedUrl: string;  signedAt: number; sigHash: string }
  | { ok: false; reason: "user_declined" | "no_cert" | "doc_too_large" | "upload_failed" | "wallet_offline" };

session.signDocument(req: SignRequest): Promise<SignResult>;
```

### 2.3 The "via temp upload URL" path

For documents that don't fit comfortably in a WebRTC data-channel
message (anything larger than ~64 KB practical limit), the SDK
expects the host site to provision a one-shot HTTPS URL:

```
1. Host site → its own backend: mint a temp signed URL for upload + a
                                second temp URL for retrieval of the
                                signed result. (S3 presigned, Cloudflare
                                R2 signed, GCS signed — whichever the
                                site already uses.)
2. Host site → SDK:             session.signDocument({
                                  source: { kind: "url", fetchUrl,
                                             uploadUrl } })
3. SDK → wallet over WebRTC:    { msg: "sign-request", documentName,
                                  reason, fetchUrl, uploadUrl,
                                  appearance? }
4. Wallet:                       fetches the doc (HTTPS), shows the
                                  signing sheet, user approves, wallet
                                  signs PAdES on-device + PUTs signed
                                  bytes to uploadUrl.
5. Wallet → SDK over WebRTC:    { msg: "sign-result", ok: true,
                                  signedUrl: fetchUrl-but-pointing-at-
                                  the-signed-blob, signedAt, sigHash }
                                  -- or { ok: false, reason }.
6. SDK → host page:              session.signDocument()'s Promise resolves.
```

Critically, the SIGNED document never enters Prson infrastructure
— it travels host → wallet (over HTTPS) → host (over HTTPS, via the
uploadUrl). Prson only sees the request metadata (document name,
reason) over the encrypted WebRTC channel.

### 2.4 Security

| Concern | Mitigation |
|---|---|
| A malicious site signs arbitrary docs without consent | The wallet's signing sheet ALWAYS shows the doc preview + name + reason + domain. The user taps Approve per signing request. Same UX as the existing on-device PDF signer. |
| Signing sheet asks for a doc that's actually malware | The wallet's fetcher refuses non-PDF MIME types and caps download at 10 MB. Sandboxed PDF renderer for the preview. |
| Replay of a signed document to a different verifier | The wallet embeds the requesting `domain` into the PAdES signed-attributes block. A verifier on a different domain sees the mismatch. |
| The upload URL is leaked / replayed | Host site is responsible for one-shot URLs with short TTLs (≤ 5 min). The SDK passes them through without storing. |

### 2.5 What it does NOT support (v1)

- **Multi-signer documents** — the wallet signs ONE PAdES signature
  per request; chained signatures require a separate flow.
- **Documents > 10 MB** — capped on the wallet side. Defer to
  out-of-band signing (the existing Sign-a-Document screen in the
  app).
- **Non-PDF formats** — only PAdES on PDF for v1. CMS-detached signing
  of arbitrary blobs is a future extension.

---

## 3. Implementation order (when we get to it)

1. Lifecycle events (§1) — **SDK side shipped.** Wallet side still
   needs to emit `claim-update` / `display-update` /
   `credential-revoked` envelopes; until then only `signed_in`,
   `renewed`, and `signed_out` actually fire. SDK contract is
   forward-compatible — unknown `envelope.msg` values are silently
   ignored, so a wallet shipping new events doesn't require an SDK
   bump.
2. `session.canSignDocuments()` (§2) — single getter, no transport
   change. Tells host sites whether to expose a "Sign" affordance.
3. `session.signDocument()` (§2) — depends on (1) for the
   `sign-request` / `sign-result` message types being wired in.

Each can ship behind a feature flag (`sdk.experimental.events`,
`sdk.experimental.signing`) until the API surface settles.
