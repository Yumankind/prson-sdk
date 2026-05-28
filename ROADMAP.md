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
  // emits these when the underlying source changes:
  | { type: "claim_added";    name: string; value: unknown }
  | { type: "claim_removed";  name: string }
  | { type: "claim_updated";  name: string; oldValue: unknown; newValue: unknown }

  // Display-only updates. Don't carry crypto material; just hints
  // for the host to refresh its UI. The wallet decides whether to
  // include these in the channel (user can disable from the active-
  // sessions tile if a domain shouldn't see live updates).
  | { type: "display_name_changed"; displayName: string | null }
  | { type: "avatar_changed";       avatar: { url: string; hash: string } | null }

  // Compliance / status updates from the issuer (notary) side.
  | { type: "credential_revoked";   reason: "alias_transferred" | "user_revoked" | "key_compromised" };
```

### 1.2 Wire integration

All non-sign-in events flow on the same WebRTC data channel the
session already owns. They use the same NaCl-boxed envelope shape,
with `envelope.msg` extended:

```
envelope.msg ∈ {
  "presentation",     // existing — full SD-JWT-VC delivery (initial + renewals)
  "revoke",            // existing — wallet-side sign-out
  "claim-update",      // NEW: { delta: {added,removed,updated} }
  "display-update",    // NEW: { displayName?, avatar? }
  "credential-revoked" // NEW: { reason }
}
```

The host subscribes via:

```ts
session.on("claim_updated", (e) => {
  if (e.name === "verification_level") refreshTrustBadge(e.newValue);
});
session.on("avatar_changed", (e) => {
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

1. Lifecycle events (§1) — strict superset of what we have today.
   Land alongside the mobile login drawer in phase 2b; the wallet
   already knows which (identity, domain) sessions exist + when
   their identity changes.
2. `session.canSignDocuments()` (§2) — single getter, no transport
   change. Tells host sites whether to expose a "Sign" affordance.
3. `session.signDocument()` (§2) — depends on (1) for the
   `sign-request` / `sign-result` message types being wired in.

Each can ship behind a feature flag (`sdk.experimental.events`,
`sdk.experimental.signing`) until the API surface settles.
