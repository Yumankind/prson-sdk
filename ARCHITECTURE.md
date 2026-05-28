# Architecture — Prson Login SDK

> Wire-format specification + protocol spec for the SDK. This document
> is the canonical source of truth; if the code disagrees with this
> doc, treat the doc as authoritative until a versioned change is
> negotiated.

---

## 0. Notation

- `b64u(x)`     — base64url(x), no padding (`=` characters stripped).
- `||`          — byte concatenation.
- `sha256(x)`   — SHA-256 of x, raw 32 bytes.
- `x25519(k,P)` — X25519 scalar mult.
- `secretbox(k, msg)` — XSalsa20-Poly1305 authenticated encryption, NaCl
  `crypto_secretbox` (24-byte nonce + 16-byte authenticator, prepended).
- `box(senderSk, recipientPk, msg)` — NaCl public-key authenticated box
  (`crypto_box`): X25519 ECDH → HSalsa20 KDF → `secretbox`.

## 1. Identities

Three keypairs participate. They never mix.

| Key | Owner | Algorithm | Lifetime | Purpose |
|---|---|---|---|---|
| Notary issuer key | Prson server-side | RSA-2048, RS256 | rotating (keyring) | Signs the issuer JWS of every SD-JWT-VC. |
| Identity key | Mobile wallet (device-stored, mnemonic-recoverable) | Ed25519 | as long as the mnemonic survives | Signs every KB-JWT. Same key serves as the holder's `cnf.jwk` in the VC and survives device migration. |
| Browser ephemeral key | Website page (in-memory only) | X25519 | one login attempt (≤ 15 min) | Receives the encrypted SD-JWT-VC over the WebRTC data channel. Discarded after the session expires or the page unloads. |

Why not use the identity key for transport encryption too? Mixing
signing keys and KX keys is forbidden by every modern crypto AGL.
The wallet keeps Ed25519 (signing) and never derives anything from it
on the fly; the browser keeps X25519 (KX) and never signs with it.

## 2. Surfaces

```
   ┌─────────────────────────────────────────────────────────────────────┐
   │ Cloudflare Workers (edge, the ONLY relay-path API surface)          │
   │  · POST /session/draft   — anonymous, IP-rate-limited; returns     │
   │                            reqId + draftToken + signalingWss.      │
   │                            No TURN allocated.                       │
   │  · POST /session/claim   — wallet-signed (Ed25519); verifies sig,   │
   │                            promotes DO to ACTIVE, mints CF TURN.    │
   │  · wss://…/login/v1/<r>  — both peers WS-connect with their HMAC    │
   │                            role token; DO fans signals.             │
   │  · Durable Object per reqId   · DRAFT → ACTIVE → closed             │
   │     · cached offer/answer/ICE · 60 s draft TTL, 15 min session TTL  │
   │  · Cloudflare TURN minted server-side (API token = Worker secret)   │
   └─────────────────────────────────────────────────────────────────────┘
             ▲                                          ▲
             │ HTTPS POST + WS                          │ HTTPS POST + WS
             │ (anonymous draft;                        │ (Ed25519 sig on claim;
             │  draftToken on WS)                       │  walletSessionToken on WS)
             │                                          │
   ┌─────────┴───────────────────┐          ┌───────────┴────────────────┐
   │ Browser (SDK)               │          │ Mobile wallet              │
   │  · X25519 ephemeral keypair │          │  · Ed25519 identity key    │
   │  · QR renderer + verifier   │          │  · per-domain rekey HKDF   │
   │  · RTCPeerConnection        │ ◄══ NaCl ══► RTCPeerConnection         │
   │    (STUN only — wallet      │   box      │  + Cloudflare TURN ICE   │
   │     allocates the relay)    │ P2P data   │    creds from /claim     │
   └─────────────────────────────┘  channel   └────────────────────────────┘

   ┌─────────────────────────────────────────────────────────────────────┐
   │ Firebase Functions (credential-issuance ONLY — unrelated to relay)  │
   │  · issueIdentityCredential        — mints the SD-JWT-VC the wallet  │
   │                                     presents, with cnfJwkOverride   │
   │                                     for the per-domain holder key.  │
   │  · revokeIdentityCredential       — wallet-driven sign-out.         │
   │  · jwtVcIssuerMetadata            — JWKS for verifiers.             │
   └─────────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │ Firebase ID token
                                  │ (wallet only; the browser SDK never
                                  │  calls Firebase directly — partner
                                  │  sites don't need Firebase config)
                                  │
                          ┌───────┴────────┐
                          │  Mobile wallet │
                          └────────────────┘
```

Two separate planes — the **relay** and the **credentials**:

1. **Cloudflare Worker** is the **single API surface for the relay**.
   Three routes (`POST /session/draft`, `POST /session/claim`, the WS
   upgrade) plus a Durable Object per `reqId`. Browser SDK + wallet
   talk to the Worker directly; **no Firebase Functions in the path**.
   Partner sites embedding the SDK never need Firebase config.
   Cloudflare TURN credentials are minted inside the Worker (API token
   is a Worker secret), only after `/session/claim` verifies a wallet
   Ed25519 signature.
2. **Firebase callables** handle only the **credential-issuance** path
   (`issueIdentityCredential` + its per-domain `cnfJwkOverride` mode,
   `revokeIdentityCredential`, and the public `jwtVcIssuerMetadata`
   JWKS endpoint). Those are wallet-only calls, Firebase-authenticated,
   and never traverse the browser SDK.

The transport is **WebRTC peer-to-peer with Cloudflare TURN as a
fallback relay** — chosen over a hosted SFU because we're moving
~50 KB of data-channel messages per session, not media. Cost
profile is ~1000× lower (see [`SECURITY.md` §6](./SECURITY.md)).

Cloudflare's TURN only sees relayed bytes — which are NaCl-boxed
ciphertext anyway — and only when direct P2P is impossible. Most
users get a direct connection; the credential never traverses Prson's
or Cloudflare's servers in plaintext.

### 2.1 Per-domain holder key (cnf.jwk) rekey

The holder's `cnf.jwk` in the VC is **derived per-verifier-domain**:

```
sigSeed_for_domain = HKDF-SHA256(
  ikm   = identityEd25519PrivateKey,
  salt  = "prson-login-rekey/v1",
  info  = utf8(verifier_domain),
  len   = 32,
)
sigKey_for_domain  = Ed25519.fromSeed(sigSeed_for_domain)
```

Consequences:

- **Same user on the same site** → always the same `cnf.jwk.x`. The
  site uses it as a stable per-user identifier.
- **Same user on different sites** → unrelated public keys. No
  observer (including Prson) can link a holder across sites by
  comparing `cnf.jwk` values.
- **Migration-safe**: the per-domain key is fully determined by the
  identity key (which is mnemonic-recoverable), so a new device
  derives the same per-domain key on a fresh install.

The VC the wallet presents is **re-issued on-demand** with the
per-domain `cnf.jwk` via the `issueIdentityCredentialForDomain`
callable (server reuses the existing notary signing path; the only
difference is the `cnf` bound into the JWS).

## 3. Flows

### 3.1 Cross-device QR flow (the default)

```
0. Browser:
   - ephKeys = X25519.generateKeyPair()
   - reqId  = randomBytes(16)               // 128-bit request id
   - nonce  = randomBytes(32)               // SD-JWT-VC nonce
   - request = {
       reqId, nonce,
       domain: window.location.hostname,
       required: { minVerificationLevel, requiredClaims, predicates,
                   identityType, ttlMaxMinutes },
       browserPk: b64u(ephKeys.publicKey),
     }

1. Browser → Cloudflare Worker: POST /session/draft  { request }
   ←  { reqId,
        draftToken,                                  // role-tagged HMAC, browser
        signalingWss: "wss://signaling.prson.net/login/v1/<reqId>",
        draftExpiresAt }                             // 60 s
   (Anonymous, IP-rate-limited at 30 drafts/IP/min in a KV-backed
    counter. The Worker stores `canonical(request)` content-addressed
    in the Durable Object — the wallet later proves consent by signing
    the matching tuple. NO TURN allocated yet; the relay capacity is
    only allocated once a wallet signs §step 3.)

2. Browser:
   - Creates RTCPeerConnection with **STUN only** (the browser side
     does not allocate any TURN relay — see §6).
   - Creates a data channel ("prson-login").
   - Opens WebSocket to signalingWss with draftToken in
     Sec-WebSocket-Protocol.
   - Generates SDP offer → sends as { msg: "offer", sdp } over the WS.
   - As ICE candidates trickle in → sends as { msg: "candidate", ... }.
   - Listens for the wallet's { msg: "answer", sdp } and
     { msg: "candidate", ... } on the same WS (cached by the DO until
     a wallet joins).
   - Renders QR encoding the deep-link URL:
       prson://login/v1?
         s=<reqId>&
         p=<browserPk>&
         n=<nonce>&
         d=<domain>&
         req=<b64u(request)>

3. Wallet (on Approve):
   - User scans QR (or taps a same-device deep link).
   - Wallet signs the claim tuple with its persistent identity Ed25519
     key:
       sigBytes = Ed25519.sign(
         "prson-login-claim/v1\n" + reqId + "\n" + walletPkX + "\n" +
           ts + "\n" + domain
       )
   - Wallet calls POST /session/claim on the Worker with
     { reqId, walletPk: <Ed25519 OKP JWK>, ts, domain, signature }.
     The Worker:
       · verifies the Ed25519 signature against `walletPk`,
       · echoes-checks the domain against the stored draft (anti-tamper),
       · promotes the DO from DRAFT → ACTIVE (resetting the alarm to a
         full 15-min TTL),
       · mints Cloudflare TURN credentials (the API token is a Worker
         secret; the wallet never sees the long-lived secret).
     Worker returns { request, walletSessionToken, signalingWss, turn,
                       expiresAt }.
   - Wallet derives the per-domain holder key:
       sigSeed = HKDF(identityKey, salt="prson-login-rekey/v1", info=domain)
       sigKey  = Ed25519.fromSeed(sigSeed)
     and asks the Firebase notary to re-issue the chosen VC with the
     matching cnf.jwk via issueIdentityCredentialForDomain (see §5).
   - Wallet shows the login drawer:
        Sign in to <domain>?
        Required: <required claims + predicates>
        Identity: <currently selected>      [change]
        Disclosing: <toggle list>           [...]
        Credential will be valid for <ttlMinutes> min      [renew]
        [Approve]  [Decline]
   - On Approve: wallet sets up its own RTCPeerConnection (with TURN
     creds from /session/claim), opens its own WS to signalingWss using
     walletSessionToken in Sec-WebSocket-Protocol, exchanges SDP answer
     + ICE candidates with the browser.

4. Wallet (on Approve, after WebRTC connection is established):
   - presentationPrefix = presentSdJwt(storedSdJwt, chosenClaimNames)
       → "<JWS>~<d_i>~…~"
   - kbJwt = SdJwtKb.buildAndSign({
        presentationPrefix,
        audience: "https://<domain>",
        nonce,
        signer: Ed25519.sign(sigKey, _) })            // per-domain key
   - presentation = presentationPrefix + kbJwt
   - envelope = {
        v: "prson_vp_v1",
        msg: "presentation",
        ttlMinutes, domain, issuedAt,
        presentation,
        fragments: [SignedFragment, ...]
     }
   - walletPerMsgSk = X25519.keypair()
   - ciphertext = box(walletPerMsgSk, browserPk, JSON(envelope))
   - Wallet sends ciphertext on the data channel.

5. Browser:
   - Receives ciphertext, decrypts with browserSk + walletPerMsgPk.
   - Verifies the issuer JWS over the SD-JWT-VC (resolves issuer key
     via did:web:app.prson.net or /.well-known/jwt-vc-issuer).
   - Verifies the KB-JWT signature against the SD-JWT's cnf.jwk.
   - Checks: aud === "https://<domain>",
             nonce === requested nonce,
             sd_hash === sha256(presentationPrefix).
   - Reassembles disclosed claims.
   - Tears down the signaling Firestore doc.
   - Resolves the SDK's signIn() Promise with `result`.

6. Session lifecycle:
   - Wallet remembers the signalingDocPath (it can re-establish the
     RTCPeerConnection for renewals by reposting an offer).
   - Wallet stores an "Active web session" entry per (domain, identity)
     locally — see "Active web sessions" tile on the identity screen.
   - At T-60s the wallet fires a local notification asking the user to
     renew. On approve → repeat steps 3-5 with a fresh KB-JWT (new
     nonce, refreshed iat). On ignore → session lapses; browser drops
     the cookie via the SDK's `onExpiry` callback.
```

### 3.2 Same-device deep-link flow

Same protocol as cross-device, just the QR step is skipped — the
browser opens `prson://login/v1?...` (universal link) on tap, the
wallet handles it directly, and either:

- Returns through a universal-link callback (`https://<domain>/__prson_login_return?token=...`), OR
- Pushes through the same WebRTC channel (more robust, recommended).

The SDK auto-detects which fallback to use based on user-agent + the
WebRTC handshake completion.

### 3.3 Renewal flow

```
1. Wallet (T-60s timer fires OR user taps the active-session tile):
   - Re-opens its WS to the same `signalingWss` and re-runs the
     SDP/ICE exchange (the Durable Object is still ACTIVE because
     /session/claim's session TTL has not expired).
   - Repeats steps 4-5 of §3.1 with:
       · fresh `nonce` (new randomBytes(32) generated by the wallet
         and ALSO sent verbatim; the browser doesn't need to coordinate
         a new nonce because the SDK accepts any monotonic nonce
         within the same session)
       · fresh `iat`
       · same `aud`, same disclosed claim set (so the user doesn't
         get re-prompted) — UNLESS the user opened the active-session
         tile and changed the disclosure list.

2. Browser:
   - Verifies the new presentation exactly like the first one.
   - Fires `onRenewed(freshCredential)` to the host application.
```

### 3.4 OpenID4VP fallback (transport-only divergence)

For interop with partners that already speak OpenID4VP, the SDK can
operate in compat mode:

- Step 2's QR encodes an `openid4vp://` URL instead of `prson://login/v1?`.
- The wallet POSTs the presentation envelope (without box-encryption)
  directly to `response_uri` over HTTPS.
- The website's backend processes the response per OIDC4VP §6.

The credential payload is identical. Use this when integrating with
an enterprise SSO product that already does OpenID4VP.

## 4. Payload schemas

### 4.1 QR URL (the deep link)

```
prson://login/v1?
  s=<b64u reqId, 32 chars>
  p=<b64u(X25519 browser pk, 32 bytes)>
  n=<b64u(nonce, 32 bytes)>
  d=<domain, url-encoded>
  req=<b64u(JSON request)>
```

**Why the request is duplicated** in `req` AND echoed back by the
Worker: the wallet's `POST /session/claim` returns the canonical
server-stored `request` (uploaded by the genuine browser during
`POST /session/draft`), which the wallet compares byte-for-byte
against the QR's `req` blob. A tampered QR (e.g. attacker swaps `d`)
fails this check. The Worker also independently rejects the claim
with `401 domain-mismatch` if the wallet signed for a different
domain than the stored draft. See [SECURITY.md §3](./SECURITY.md)
for the full anti-tamper argument.

The QR carries **no relay credentials** — the wallet obtains its
TURN credentials + walletSessionToken from `/session/claim` after
signing, so a leaked QR can't be used to burn relay capacity.

### 4.2 WebRTC data-channel envelope

Plaintext JSON (then box-encrypted, then base64url'd, then sent as a
single data-channel message):

```json
{
  "v": "prson_vp_v1",
  "msg": "presentation" | "renewal" | "revoke" | "decline",
  "issuedAt": 1717000000,
  "ttlMinutes": 10,
  "domain": "example.com",
  "presentation": "<SD-JWT-VC compact presentation>",
  "fragments": [
    { "fragmentId": "age_gte_18", "value": true,
      "signature": "<base64>", "signedAt": "...", "expiresAt": "..." }
  ]
}
```

Wire format:

```
data_channel_message = {
  ephPk:    b64u(wallet's per-message X25519 pk, 32 bytes),
  nonce24:  b64u(24-byte nonce),
  ct:       b64u(secretbox ciphertext + authenticator),
}
```

Encryption: `box(walletEphSk, browserPk, plaintext)` where `walletEphSk`
is fresh per message — the wallet uses NaCl `box` (not `box_seal`)
so the browser also authenticates the sender, and per-message keys
mean forward secrecy.

### 4.3 SDK signIn() result

```ts
type SignInResult = {
  /** Full compact SD-JWT-VC presentation including KB-JWT — pass to
   *  your verifier-side code if you want to re-verify there. */
  sdJwtVc: string;

  /** Decoded + verified disclosed claims. Convenience copy. */
  claims: Record<string, unknown>;

  /** Holder's Ed25519 public JWK from the VC's cnf.jwk. Treat this as
   *  the user's persistent identifier across sessions on this site. */
  cnf: { jwk: { kty: "OKP"; crv: "Ed25519"; x: string } };

  /** Issuer metadata of the credential (vct + iss + kid). */
  credential: {
    vct: "https://app.prson.net/credentials/verified-identity/v1"
       | "https://app.prson.net/credentials/verified-human/v1";
    iss: "did:web:app.prson.net";
    kid: string;
    expiresAt: number; // ms epoch
  };

  /** Live session handle. Use to subscribe to renewals + expiry. */
  session: PrsonLoginSession;
};
```

## 5. Server-side surface

### 5.1 Cloudflare Worker (login-sdk/infra/signaling-worker/)

The **single API surface for the relay path**. Three routes plus a
Durable Object per `reqId`.

| Route | Auth | Description |
|---|---|---|
| `POST /session/draft` | anonymous, IP-rate-limited (default 30/IP/min, in a KV namespace) | Browser-initiated. Hashes `request` → `reqId`. Stores canonical bytes in the DO (status `DRAFT`). Returns `{reqId, draftToken, signalingWss, draftExpiresAt}`. **No TURN allocated.** Draft auto-expires in 60 s if not claimed. |
| `POST /session/claim` | Ed25519 signature over the canonical claim tuple `"prson-login-claim/v1\n" + reqId + "\n" + walletPkX + "\n" + ts + "\n" + domain` | Wallet-initiated. Worker verifies signature, echoes-checks the domain against the stored draft, promotes DO to `ACTIVE`, mints Cloudflare TURN creds (Worker secret-bound `CF_TURN_KEY_ID` + `CF_TURN_API_TOKEN`), returns `{request, walletSessionToken, signalingWss, turn, expiresAt}`. |
| `GET wss://…/login/v1/<reqId>` | role-tagged HMAC: `<exp>.<role>.<HMAC-SHA256(reqId\nrole\nexp)>` issued by the routes above | WS upgrade for either peer. The Worker reads the token from `Sec-WebSocket-Protocol`, verifies, then forwards into the DO. |

Token formats (single Worker secret `SIG_TOKEN_HMAC_SECRET` signs both):

- `draftToken` = HMAC over `reqId\n"browser"\n<exp=now+60s>`.
- `walletSessionToken` = HMAC over `reqId\n"wallet"\n<exp=now+15min>`.

Inside the Durable Object `LoginSession`:

- `state = { status: "draft"|"active"|"closed", canonical, domain,
             draftExp, sessionExp, walletPkX, cached: SignalingMessage[] }`
- DRAFT alarm fires at `draftExp` → closes if unclaimed.
- ACTIVE alarm fires at `sessionExp` (= 15 min after claim) → closes.
- On WS upgrade: only the role from the verified token is allowed
  (one socket per role; reconnects replace the prior).
- Caches SDP offer/answer + ICE candidates so the late-joining wallet
  receives the browser's already-emitted handshake immediately.

Cost: ~$0.10 per 100K sessions (Workers $0.30/M req + Durable Objects
$0.15/M req + tiny KV). Latency: <100 ms globally (DOs run at the
edge nearest to whichever peer connects first).

### 5.2 What stays on Firebase

Only the **credential-issuance** path — unrelated to the relay:

| Callable | Auth | Description |
|---|---|---|
| `issueIdentityCredential` | Firebase ID token (wallet) | Mints the VC. Existing callable; accepts an optional `cnfJwkOverride` + `bindToDomain` to swap the cnf for the per-domain Ed25519 key the wallet derives. |
| `revokeIdentityCredential` | Firebase ID token (wallet) | Marks the wallet's credentials revoked. |
| `jwtVcIssuerMetadata` | unauth (HTTPS) | Serves the JWKS at `/.well-known/jwt-vc-issuer`. |

Cloudflare TURN credentials are NOT minted here; they're minted by
the Worker on `/session/claim` where the API token is a Worker secret.

### 5.3 Session TTL

| Surface | TTL |
|---|---|
| `draftToken` HMAC | 60 s (must be claimed by a wallet within this window) |
| `walletSessionToken` HMAC | 15 min (from /session/claim → DO alarm) |
| Cloudflare TURN credentials | 15 min (minted only on /session/claim) |
| Durable Object | auto-destroys at draftExp OR sessionExp (whichever applies) |
| VC the wallet emits | `exp` = min(requested TTL, 15 min) |

## 6. Standards compatibility

The credential payload conforms to:

- [IETF SD-JWT-VC](https://datatracker.ietf.org/doc/draft-ietf-oauth-sd-jwt-vc/) — issuer JWS, disclosures, KB-JWT, `cnf.jwk`.
- [IETF SD-JWT](https://datatracker.ietf.org/doc/draft-ietf-oauth-selective-disclosure-jwt/) — the underlying selective-disclosure protocol.
- [OpenID4VP](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html) — when running in compat mode (§3.4).
- [DID Core / did:web](https://w3c-ccg.github.io/did-method-web/) — issuer key resolution.

A partner using **any compliant SD-JWT-VC verifier** (Sphereon, walt.id,
Procivis, EUDI Wallet ref) can verify a Prson presentation without
running our SDK. The SDK only matters for the **transport** (WebRTC E2E
encryption + the renewal/sessions UX). The credential it delivers is a
plain SD-JWT-VC.

## 7. Open questions

Resolved (decisions locked into this spec):

- **Transport relay**: ✅ Cloudflare TURN (not LiveKit). ~1000× cheaper
  for our 2-peer data-channel profile; no SFU needed.
- **Signaling**: ✅ Cloudflare Workers + Durable Objects via WebSocket.
  No Firestore on the realtime path; third-party sites embedding the
  SDK never touch our Firebase project.
- **Holder cnf.jwk binding**: ✅ per-domain rekey via
  `HKDF(identityKey, "prson-login-rekey/v1", domain)`. Same user on
  same site → stable id; different sites → unlinkable.

Still open (deferred to v2):

- **Sealed-sender variant** — even with per-domain rekey, Cloudflare
  TURN sees that a peer is publishing for a given relay session.
  Future option: derive an ephemeral wallet-side identity per message
  and use `box_seal` to avoid revealing the per-domain key on the wire.
  Trade-off is per-message replay protection (currently part of
  mutual `box`); would need a per-room sender commitment.
- **Status-list endpoint** — for instant cross-revocation when a VC is
  revoked mid-session. Currently sessions lapse at TTL after revoke.
- **Same-origin iframe embedding** — the SDK assumes top-level frame.
  Iframed-into-a-different-origin scenarios need extra origin-binding
  rules so a malicious outer page can't impersonate the inner site's
  domain on the KB-JWT `aud`.
