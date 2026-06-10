# Architecture — Prson Login SDK

> Wire-format specification + protocol spec for the SDK. This document
> is the canonical source of truth; if the code disagrees with this
> doc, treat the doc as authoritative until a versioned change is
> negotiated.

---

## Packages

| Package | Status | What it ships |
|---|---|---|
| [`@prson/login-sdk`](packages/browser) | base, headless | The crypto, signaling, and encryption pipeline. Reads `window.__prsonLoginQrRenderer` at `signIn()` time; bring your own QR drawing or use the companion below. |
| [`@prson/login-sdk-ui`](packages/browser-ui) | optional UI | Drop-in styled QR card with TTL countdown + refresh affordance. Side-effect registers itself on the global the base SDK reads; one extra `<script>` tag and `signIn()` Just Works. Partners with their own design system can omit it. |
| [`@prson/login-verifier`](packages/verifier-node) | server-side helper | Re-verifies an SD-JWT-VC presentation on the verifier's backend. Independent of the relay path. |

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
   │     · cached offer/answer/ICE · 180 s draft TTL, 15 min session TTL │
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

**Opt-out: ephemeral (device-local) per-domain key.** When the verifier
opts in to `ephemeralIdentity: true`, the HKDF derivation above is
skipped: the wallet mints a fresh random Ed25519 keypair on first
sign-in, persists the 32-byte seed in this-device-only secure storage,
and reuses it on subsequent sign-ins to the same domain. The verifier
still sees a stable per-user id (same `cnf.jwk.x` across sessions on
this device), but mnemonic compromise no longer de-anonymises the user
on this site — and changing devices loses access to the account. See
§5.4 for the persistence semantics.

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
       allowAnonymous: <bool>,    // verifier opts in to self-signed
                                  // anonymous-wallet credentials
       ephemeralIdentity: <bool>, // verifier requests a fresh per-sign-in
                                  // key (no stable per-site identifier)
       returnUrl: <string?>,      // app-to-app return leg: https URL the
                                  // wallet opens after delivering the
                                  // credential. Wallet enforces https +
                                  // host == domain EXACTLY (the worker-
                                  // verified login domain), so it can
                                  // only bounce to the signed-in site's
                                  // own Universal/App Link. See
                                  // SIGN-IN-WITH-PRSON-IDENTITY.md
                                  // §App-to-app.
     }

1. Browser → Cloudflare Worker: POST /session/draft  { request }
   ←  { reqId,
        draftToken,                                  // role-tagged HMAC, browser
        signalingWss: "wss://signaling.prson.net/login/v1/<reqId>",
        draftExpiresAt,                              // 180 s
        serverTs }                                   // epoch-seconds, server-issued
   (Anonymous, IP-rate-limited at 30 drafts/IP/min in a KV-backed
    counter. The Worker also enforces an **Origin-header check** — the
    page Origin must match `request.domain`, else 400 `origin-required`
    / 403 `origin-domain-mismatch` (closes audit §C-1).
    The Worker stores `canonical(request)` PLUS a freshly-stamped
    `serverTs = nowSec` in the Durable Object — the wallet never
    computes time; the same `serverTs` rides the QR back to the wallet
    via the `t=` param (§4.1) and is reconstructed server-side at
    verify time (§step 3). NO TURN allocated yet; the relay capacity
    is only allocated once a wallet signs §step 3.)

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
   - Renders QR encoding the deep-link URL (universal link form;
     §4.1 lists the schema):
       https://app.prson.net/login/v1?
         s=<reqId>&
         p=<browserPk>&
         n=<nonce>&
         d=<domain>&
         req=<b64u(request)>&
         t=<serverTs>           // echoed verbatim from /session/draft

3. Wallet (on Approve):
   - User scans QR (or taps a same-device deep link).
   - Wallet signs the **v2** claim tuple with its persistent identity
     Ed25519 key. The timestamp is the **server-issued** `serverTs`
     parsed from the QR's `t=` param — the wallet never computes time:
       sigBytes = Ed25519.sign(
         "prson-login-claim/v2\n" + reqId + "\n" + walletPkX + "\n" +
           serverTs + "\n" + domain
       )
   - Wallet calls POST /session/claim on the Worker with
     { reqId, walletPk: <Ed25519 OKP JWK>, domain, signature }.
     **No `ts` field** — the Worker reads its own stored `serverTs`
     from the Durable Object and reconstructs the canonical bytes
     itself. The Worker:
       · loads the DO state, reconstructs the v2 canonical bytes from
         the STORED serverTs (not anything the wallet supplied),
       · verifies the Ed25519 signature against `walletPk` inside the
         Durable Object, atomically with the state transition,
       · echoes-checks the domain against the stored draft (anti-tamper),
       · promotes the DO from DRAFT → ACTIVE (resetting the alarm to a
         full 15-min TTL),
       · mints Cloudflare TURN credentials (the API token is a Worker
         secret; the wallet never sees the long-lived secret).
     Worker returns { request, walletSessionToken, signalingWss, turn,
                       expiresAt }.
   - If the verifier requested `ephemeralIdentity: true`, the wallet
     generates a fresh Ed25519 keypair for this sign-in (no HKDF) and
     uses that as the per-message holder key — no stable per-site id.
   - Otherwise wallet derives the per-domain holder key:
       sigSeed = HKDF(identityKey, salt="prson-login-rekey/v1", info=domain)
       sigKey  = Ed25519.fromSeed(sigSeed)
     and asks the Firebase notary to re-issue the chosen VC with the
     matching cnf.jwk via issueIdentityCredentialForDomain (see §5).
   - If the verifier set `allowAnonymous: true` and the user picks an
     anonymous identity in the drawer, the wallet skips the notary and
     emits a self-signed **anonymous-wallet credential** instead
     (VCT `https://app.prson.net/credentials/anonymous-wallet/v1`).
     The per-domain (or ephemeral) Ed25519 key is BOTH the JWT signer
     AND the `cnf.jwk`. The browser SDK verifies it via
     `verifyAnonymousWallet`.
   - Wallet shows the login drawer:
        Sign in to <domain>?
        Required: <required claims + predicates>
        Identity: <currently selected>      [change]
        Disclosing: <toggle list>           [...]
        Credential will be valid for <ttlMinutes> min      [renew]
        [Approve]  [Decline]
   - On Approve: wallet sets up its own RTCPeerConnection (with TURN
     creds from /session/claim **and `iceTransportPolicy: "relay"` by
     default** — host + server-reflexive candidates are never gathered
     so the wallet's local IP never leaves the device; closes audit
     §M-4). Opens its own WS to signalingWss using `walletSessionToken`
     in Sec-WebSocket-Protocol, exchanges SDP answer + ICE candidates
     with the browser.

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
browser opens `https://app.prson.net/login/v1?...` (Apple Universal
Link / Android App Link, claimed by the wallet via AASA +
`assetlinks.json`) on tap, the wallet handles it directly, and either:

- Returns through a universal-link callback (`https://<domain>/__prson_login_return?token=...`), OR
- Pushes through the same WebRTC channel (more robust, recommended).

Universal Links replaced the legacy `prson://login/v1?...` custom
scheme to close audit §C-2 — any installed app can register a custom
scheme, but only the app whose AASA the OS verified can intercept a
Universal Link. The wallet's `LoginDeepLink.tryParse` still accepts
both forms for back-compat with QRs already in the wild.

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
https://app.prson.net/login/v1?               // universal link (preferred)
  s=<b64u reqId, 32 chars>
  p=<b64u(X25519 browser pk, 32 bytes)>
  n=<b64u(nonce, 32 bytes)>
  d=<domain, url-encoded>
  req=<b64u(JSON request)>
  t=<serverTs, epoch seconds; server-issued at /session/draft>
```

The `req` JSON includes the verifier's full requirements blob:
`{ domain, nonce, browserPk, required, ttlMaxMinutes, allowAnonymous,
ephemeralIdentity }`. The wallet's parser fails closed if `t=` is
absent, non-numeric, or zero (v2 requires server-issued time).

The legacy `prson://login/v1?...` custom-scheme form is still parsed
for back-compat but is no longer emitted — see §3.2.

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

### 5.1 Cloudflare Worker (cloudflare-workers/signaling-worker/)

The **single API surface for the relay path**. Three routes plus a
Durable Object per `reqId`.

| Route | Auth | Description |
|---|---|---|
| `POST /session/draft` | anonymous, IP-rate-limited (default 30/IP/min, in a KV namespace) + `Origin` header must match `request.domain` (§C-1) | Browser-initiated. Hashes `request` → `reqId`. Stores canonical bytes **plus a server-stamped `serverTs = nowSec`** in the DO (status `DRAFT`). Returns `{reqId, draftToken, signalingWss, draftExpiresAt, serverTs}`. **No TURN allocated.** Draft auto-expires in 180 s (3 min) if not claimed. |
| `POST /session/claim` | Ed25519 signature over the **v2** canonical claim tuple `"prson-login-claim/v2\n" + reqId + "\n" + walletPkX + "\n" + serverTs + "\n" + domain`. The wallet does NOT supply `serverTs` in the request body — the verifying Durable Object reads it from its own stored draft state. | Wallet-initiated. The Worker route layer is a thin shim; the actual verification + state transition happens **inside the Durable Object** (atomic): DO loads stored `serverTs` + `domain`, reconstructs canonical v2 bytes, Ed25519-verifies against the supplied `walletPk`, echoes-checks the domain against the stored draft, promotes DO to `ACTIVE`, mints Cloudflare TURN creds (Worker secret-bound `CF_TURN_KEY_ID` + `CF_TURN_API_TOKEN`), returns `{request, walletSessionToken, signalingWss, turn, expiresAt}`. Moving verification inside the DO closes a TOCTOU class — the verified `serverTs` is exactly the one promoted. |
| `GET wss://…/login/v1/<reqId>` | role-tagged keyring HMAC: `<kid>.<exp>.<role>.<HMAC-SHA256(kid\nreqId\nrole\nexp)>` issued by the routes above; legacy 3-segment `<exp>.<role>.<HMAC>` accepted for in-flight back-compat | WS upgrade for either peer. The Worker reads the token from `Sec-WebSocket-Protocol`, verifies against the keyring, **pins** the token's `sha256` to the role in the DO (§M-2), then forwards into the DO. |

Token format (kid-prefixed; closes audit §M-1):

- Signed via `SIG_TOKEN_HMAC_KEYRING` env binding, a JSON `{active, retired[]}` keyring. `active` is the current minting kid; `retired[]` carry their own `validUntil` epoch so a verifier accepts in-flight tokens for a configurable window after rotation.
- `draftToken` = `<kid>.<exp=now+60s>.browser.HMAC(kid\nreqId\nbrowser\nexp)`.
- `walletSessionToken` = `<kid>.<exp=now+15min>.wallet.HMAC(kid\nreqId\nwallet\nexp)`.
- Legacy `SIG_TOKEN_HMAC_SECRET` still verifies older 3-segment tokens until they expire — see [scripts/cloudflare/login-secret.sh](../scripts/cloudflare/login-secret.sh) for the rotation playbook (`stage`, `rotate`, `prune`).

Inside the Durable Object `LoginSession`:

- `state = { status: "draft"|"active"|"closed", canonical, domain, reqId,
             serverTs, draftExp, sessionExp, walletPkX,
             pinnedTokenHashes: { browser?: sha256, wallet?: sha256 },
             cached: SignalingMessage[] }`
- `serverTs` is the Worker-issued epoch-seconds value relayed via the QR's `t=` param and re-read at `/session/claim` verification time.
- DRAFT alarm fires at `draftExp` → closes if unclaimed.
- ACTIVE alarm fires at `sessionExp` (= 15 min after claim) → closes.
- On WS upgrade: only the role from the verified token is allowed (one socket per role; reconnects replace the prior). The DO **pins** the first-seen `sha256(token)` per role; a second WS upgrade for the same role with a different token hash is rejected `401 role-token-pin-mismatch` (defends against token forgery after key rotation; §M-2).
- Caches SDP offer/answer + ICE candidates so the late-joining wallet receives the browser's already-emitted handshake immediately.
- **WebSocket Hibernation API.** The DO accepts both peers via `state.acceptWebSocket(ws, [role])` rather than `ws.accept()`. Between signaling messages the DO instance unloads from memory; the sockets stay connected, the runtime re-instantiates the DO on the next inbound message, and the `webSocketMessage` / `webSocketClose` / `webSocketError` class methods receive the event. Per-WS metadata (`role`, `joinedAt`) rides in `ws.serializeAttachment(...)` so it survives hibernation; `state.getWebSockets("browser" | "wallet")` returns the peer(s) for fan-out without needing an in-memory `peers` array. This is what keeps the per-100k-sessions duration cost in the included tier (see [`mobile-app/prson_app/docs/wallet_lifecycle.md`](../mobile-app/prson_app/docs/wallet_lifecycle.md) for the cost table).

Cost: ~$0.10 per 100K sessions (Workers $0.30/M req + Durable Objects
$0.15/M req + tiny KV) **with the WebSocket Hibernation API engaged**.
Without hibernation the duration meter alone would cost ~$136 per 100K
sessions because each WS keeps the DO ACTIVE for its 15-min TTL; with
hibernation the DO is ACTIVE only while a message handler is running
(low-millisecond bursts), and the 400 k GB-s monthly free tier covers
tens of millions of sessions before duration starts billing. Latency:
<100 ms globally (DOs run at the edge nearest to whichever peer
connects first).

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
| `draftToken` HMAC | 180 s / 3 min (must be claimed by a wallet within this window) |
| `walletSessionToken` HMAC | 15 min (from /session/claim → DO alarm) |
| Cloudflare TURN credentials | 15 min (minted only on /session/claim) |
| Durable Object | auto-destroys at draftExp OR sessionExp (whichever applies) |
| VC the wallet emits | `exp` = min(requested TTL, 15 min) |

## 5.4 Wallet-side per-domain persistence

The wallet remembers two things per verifier-domain so the drawer can
default sensibly on return visits:

| Surface | Where | Sensitivity |
|---|---|---|
| `lastIdentity.<domain>` → `DerivedIdentity.id` (or `__ephemeral__` sentinel) | `SharedPreferences` via [LoginSettingsService.rememberLastUsedIdentity](../mobile-app/prson_app/lib/core/services/login_settings_service.dart) | Non-secret — just a UX pointer. |
| `ephKey.<domain>` → b64u(32-byte Ed25519 seed) | [SecureStorageService](../mobile-app/prson_app/lib/core/storage/secure_storage_service.dart) (`first_unlock_this_device` on iOS, encrypted SharedPreferences excluded from Auto Backup on Android) | **Device-bound secret.** Treated like any other identity key on the device. |

The login drawer ([login_request_drawer.dart](../mobile-app/prson_app/lib/views/identity/login_request_drawer.dart)) pre-selects in this order: last-used identity (if still eligible) → globally-active identity (if eligible) → null (user picks). The picker still always lets the user override.

**Ephemeral-identity persistence trade-off.** When the verifier sets `ephemeralIdentity: true`, the wallet:

1. On the first sign-in to that domain: mints a fresh random Ed25519 keypair, signs the presentation with it, and **persists the seed to secure storage** keyed by domain.
2. On subsequent sign-ins to the same domain: reads the seed back, rebuilds the same keypair, and signs again — so the verifier sees the SAME `cnf.jwk.x` and the user lands back in the same anonymous account.

Why persist at all? Without persistence, `ephemeralIdentity: true` is write-only — every sign-in creates a brand-new anonymous user on the verifier's side and the previous one is unreachable. Persisting turns it into "stable per-site identifier, **device-local instead of mnemonic-derived**".

The cost is a hard one: the seed is **not** derived from the recovery phrase, so it's irrecoverable on device loss or app wipe. The drawer surfaces this explicitly — see `_deviceBoundKeyBanner()` — and the banner copy distinguishes the first-time case ("the wallet will mint a key for this site") from the returning case ("you'll see the same anonymous account").

Why not derive the ephemeral seed from the mnemonic? Because the whole point of `ephemeralIdentity: true` (audit §M-5) is that a mnemonic compromise must NOT retroactively de-anonymise every site the user ever visited. If the seed were mnemonic-derived, the security property collapses.

When the user revokes an active session for the domain (active-sessions tile → Revoke), the wallet purges both entries — see [LoginSettingsService.forgetLastUsedIdentity](../mobile-app/prson_app/lib/core/services/login_settings_service.dart) + [forgetEphemeralSeed](../mobile-app/prson_app/lib/core/services/login_settings_service.dart). The next sign-in to that domain mints a fresh key.

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
- **Exact-token WS replay from XSS** — `pinnedTokenHashes` (§5.1)
  blocks token *forgery* after rotation, but a client-side XSS can
  still steal and replay the exact original token before its TTL.
  Closes with a short-lived refresh-token endpoint that requires a
  fresh signal from the originating tab.

Shipped since the 2026-05-28 audit (see `SECURITY-AUDIT-2026-05-28.md`):

- **C-1** Origin-header binding at `/session/draft`.
- **C-2** Universal Links replace the custom `prson://` scheme.
- **M-1** HMAC keyring with `kid`-prefixed tokens + rotation script.
- **M-2** Role-token pinning in the Durable Object.
- **M-3** Claim-tuple v2: server-issued `serverTs`, verification moved into the DO.
- **M-4** `iceTransportPolicy: "relay"` default on the wallet side.
- **M-5** Opt-in `ephemeralIdentity: true` SDK flag for unlinkable per-sign-in keys.
