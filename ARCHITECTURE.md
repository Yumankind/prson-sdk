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
                                     ┌────────────────────────────────┐
                                     │ Prson cloud functions          │
                                     │  · createLoginSession (callable│
                                     │     unauth — anyone can mint)  │
                                     │  · resolveLoginSession (callable│
                                     │     wallet-auth, room metadata)│
                                     │  · LiveKit room provisioning   │
                                     └────────────────────────────────┘
                                                  ▲
            ┌─────────────────────────────────────┴────────────────────────────────┐
            │                                                                      │
            ▼                                                                      ▼
┌──────────────────────────────┐                                ┌──────────────────────────────┐
│ Browser (SDK)                │                                │ Mobile wallet                │
│  · @prson/login-sdk          │                                │  · IdentityCredentialService │
│  · X25519 ephemeral keypair  │ ◄═════ E2E-encrypted via NaCl  │  · Ed25519 identity key      │
│  · LiveKit subscriber        │      box over LiveKit data ch  │  · LiveKit subscriber        │
│  · QR renderer + verifier    │                                │  · Login drawer UI           │
└──────────────────────────────┘                                └──────────────────────────────┘
```

Prson's LiveKit cluster is a **dumb relay** — the payload that crosses
it is encrypted to the browser's ephemeral pk; Prson never holds the
plaintext. The LiveKit token is bound to a one-shot room with no
recording, expires within the session TTL.

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

1. Browser → Prson functions: createLoginSession({ request })
   ←  { roomName, livekitToken, expiresAt }       // ≤ 15 min
   (Anyone can call this; abuse-protected by IP rate limit + the request
    being content-bound: createLoginSession hashes `request` and stores it
    so the room name is reproducible / dedupable.)

2. Browser:
   - Joins LiveKit room with livekitToken (subscriber + publisher of
     data channel).
   - Renders QR encoding the deep-link URL:
       prson://login/v1?
         s=<reqId>&
         r=<roomName>&
         k=<livekitToken_for_wallet>&         // separate, short-TTL
         p=<browserPk>&
         n=<nonce>&
         d=<domain>&
         req=<b64u(request)>
   - Listens on the LiveKit data channel for "prson_vp_v1" messages.

3. Wallet:
   - User scans QR (or taps a same-device deep link with the same URL).
   - Wallet calls resolveLoginSession({ reqId }) to double-check the
     session is still alive on the server-side and pull canonical
     metadata (so a tampered QR can't lie about the domain). Server
     returns the SAME request payload it received in step 1.
   - Wallet shows the login drawer:
        Sign in to <domain>?
        Required: <required claims + predicates>
        Identity: <currently selected>      [change]
        Disclosing: <toggle list>           [...]
        Credential will be valid for <ttlMinutes> min      [renew]
        [Approve]  [Decline]

4. Wallet (on Approve):
   - presentationPrefix = presentSdJwt(storedSdJwt, chosenClaimNames)
       → "<JWS>~<d_i>~…~"
   - kbJwt = SdJwtKb.buildAndSign({
        presentationPrefix,
        audience: "https://<domain>",
        nonce,
        signer: Ed25519.sign(identityKey, _) })
   - presentation = presentationPrefix + kbJwt   // SD-JWT-VC compact
   - envelope = {
        v: "prson_vp_v1",
        ttlMinutes,
        domain,
        issuedAt,
        // The credential.
        presentation,
        // Optional on-demand fragments (age_gte_18 etc.) signed by the
        // notary just-in-time per the user's predicate selections.
        fragments: [SignedFragment, ...]
     }
   - ciphertext = box(walletEphSk, browserPk, JSON(envelope))
   - Wallet publishes ciphertext on the LiveKit data channel.

5. Browser:
   - Receives ciphertext, decrypts with browserSk.
   - Verifies the issuer JWS over the SD-JWT-VC (resolves issuer key
     via did:web:app.prson.net or /.well-known/jwt-vc-issuer).
   - Verifies the KB-JWT signature against the SD-JWT's cnf.jwk.
   - Checks: aud === "https://<domain>",
             nonce === requested nonce,
             sd_hash === sha256(presentationPrefix).
   - Reassembles disclosed claims.
   - Resolves the SDK's signIn() Promise with `result`.

6. Session lifecycle:
   - Wallet remembers the LiveKit room (it can rejoin to push renewals).
   - Wallet stores an "Active web session" entry per (domain, identity).
   - At T-60s the wallet fires a local notification asking the user to
     renew. On approve → repeat steps 4-5 with a fresh KB-JWT (new
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
LiveKit handshake completion.

### 3.3 Renewal flow

```
1. Wallet (T-60s timer fires OR user taps the active-session tile):
   - Rejoins the LiveKit room.
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
  s=<b64u reqId, 16 bytes>
  r=<roomName, opaque string>
  k=<wallet's LiveKit access token>
  p=<b64u(X25519 browser pk, 32 bytes)>
  n=<b64u(nonce, 32 bytes)>
  d=<domain, url-encoded>
  req=<b64u(JSON request)>
```

**Why the request is duplicated** in `req` AND fetched from
`resolveLoginSession`: the wallet ALWAYS calls
`resolveLoginSession({ reqId })` and compares its `request` field
against the QR's `req`. A tampered QR (e.g. attacker swaps `d`) is
detected because the server-stored version was uploaded by the
genuine browser. See [SECURITY.md §3](./SECURITY.md).

### 4.2 LiveKit data-channel envelope

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
livekit_message = {
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

Two new cloud functions in `functions/api/login-sessions.js` (TODO —
not built yet; see phase 2 in [README.md](./README.md)):

| Callable | Auth | Description |
|---|---|---|
| `createLoginSession` | unauthenticated, IP-rate-limited | Browser-initiated. Mints a one-shot LiveKit room + tokens for both browser (subscribe+publish data) and wallet (publish data). Stores `request` content-addressed. |
| `resolveLoginSession` | wallet-authenticated | Wallet-initiated, called after QR scan. Returns the canonical `request` for verification against the QR. |

LiveKit token TTL is bounded by the session TTL (15 min hard ceiling)
+ a 30-second grace.

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

These are placeholders flagged before phase 2 — not commitments:

- **LiveKit room cost model** — every login attempt mints a room, even
  if abandoned. We may need to lazy-create the room only after the
  wallet calls `resolveLoginSession` (i.e. confirmed scan).
- **Sealed-sender variant** — for stronger metadata privacy against
  Prson, swap `box` → `box_seal` (browser does not authenticate sender
  identity). Trade-off: drops wallet replay protection against another
  wallet replaying the message; mitigated by including a Schnorr-style
  per-room sender commitment.
- **Bind cnf.jwk to a per-session salt** — a re-used `cnf.jwk` across
  sites is the only stable cross-site identifier in this design. For
  use cases that want unlinkability, add a per-domain rekey derived
  from `HKDF(identityKey, "site-rekey/" || domain)`. **Default
  remains linkable** because users frequently want "the same person who
  signed in last time".
