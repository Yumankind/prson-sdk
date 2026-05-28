# Security — Prson Login SDK

> Threat model, crypto rationale, and the failure modes the SDK is
> designed to make impossible. Read alongside
> [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## 1. Adversaries we model

| # | Adversary | Capability | What they want |
|---|---|---|---|
| A1 | **Phisher running a clone site** | Renders a fake login page with their own SDK call; controls the domain shown in the URL bar. | Trick the user's wallet into binding a presentation to *their* `aud`, so they can replay it elsewhere. |
| A2 | **MitM at the Prson LiveKit relay** | Sees every byte traversing the data channel; can drop, reorder, or inject packets. | Read the disclosed claims; replay; downgrade. |
| A3 | **Hostile other tab / extension** | Same-origin JavaScript on the legitimate site; OR a malicious extension with `<all_urls>` permission. | Steal the X25519 secret key, the SD-JWT-VC, or the session token. |
| A4 | **Stolen / unlocked phone briefly** | Has the mobile app open for ≤ 60 s. | Approve a login they didn't initiate. |
| A5 | **Compromised Prson server** | Can mint LiveKit tokens, see room metadata, but cannot forge the **notary RSA key** (HSM-resident in prod). | Approve fake VCs (caught: bad issuer signature), or trick the SDK into a fake session (caught: see §3). |
| A6 | **Long-term offline attacker** | Records the entire LiveKit traffic now, attacks later. | Decrypt past sessions. |
| A7 | **Replay attacker** | Captured a legitimate presentation. | Resubmit it to the same or a different verifier. |
| A8 | **User loses their phone** | The mnemonic is somewhere else (e.g. recovery card). | Take over the account on a website. |

The crypto and protocol below defend against A1–A7 by design. A8 is
handled out-of-band via mnemonic recovery + a "Sign out everywhere"
action in the recovered wallet (see §6).

## 2. Trust anchors

Only **two** root facts a verifier must trust:

1. **The Prson notary public key set** — published as a DID document
   at [`did:web:app.prson.net`](https://app.prson.net/.well-known/did.json)
   and as a JWKS at [`/.well-known/jwt-vc-issuer`](https://app.prson.net/.well-known/jwt-vc-issuer).
   Both are static files served by Firebase Hosting under HTTPS with
   HSTS preload; rotation is publish-and-overlap — see
   [`project_notary_keyring`](../mobile-app/prson_app/docs/trust_architecture.md#4-rotation-models).
2. **`https://<domain>` is bound into the KB-JWT `aud`** by the wallet.
   The phisher in A1 *can* make the wallet bind to their own
   phishdomain (the user has to read the drawer) — see §4.1 below.

That's it. No server-side session secret, no SDK-provided seed, no
shared keys with the website.

## 3. The browser ↔ wallet handshake — why a tampered QR doesn't win

A1 wants to: render a QR on `legit-bank.com` that, when scanned,
yields a presentation bound to `phisher.evil`. Two mechanisms stop
them:

1. **The Cloudflare Worker echoes the canonical request back to the
   wallet on `/session/claim`.** That request was uploaded *by the
   genuine browser session*, on `legit-bank.com`'s page. The wallet
   side compares the QR's `req` blob with what the Worker returns and
   **rejects the login** on mismatch — the QR can't unilaterally lie
   about the domain.
2. **The Worker also re-checks** the `domain` field of the claim
   signature against the stored draft. A wallet signing for the wrong
   domain returns `401 domain-mismatch` — defence in depth even when
   the wallet skips the local echo check.
3. **The user sees `<domain>` in the drawer**, big, before they tap
   Approve. The drawer mirrors exactly what the Worker returned, so
   a clone site can't even reach this step unless they front-ran the
   entire flow on their own session, in which case the QR scan signs
   the user in to *their site*, not the user's legitimate session.

A1 can still display `legit-bank.com` in their browser URL bar
(homograph IDN attacks, lookalike domains). That's a phishing problem,
not a protocol problem — same risk profile as every "Sign in with X"
button.

## 4. Encryption-at-rest-in-transit

### 4.1 NaCl `box` for the data-channel payload

```
walletEphSk, walletEphPk = X25519.keypair()        // per message
sharedSecret = X25519(walletEphSk, browserPk)
key          = HSalsa20(sharedSecret, ZEROS)       // RFC 7693 KDF
ct           = XSalsa20-Poly1305(key, nonce24, plaintext)
```

Properties:

| Property | How it's achieved |
|---|---|
| **Confidentiality** (A2) | XSalsa20 stream cipher under a 256-bit key. |
| **Integrity** (A2) | Poly1305 authenticator over the ciphertext. |
| **Per-message forward secrecy** | `walletEphSk` is regenerated for every data-channel write. |
| **Sender authentication** (A2 injection) | Browser does X25519 with `walletEphPk` from the same message; an attacker can't substitute a different sender without the receiver detecting (NaCl `box` is mutual). |
| **Long-term forward secrecy** (A6) | The browser's `ephSk` is discarded on page unload and never persisted. Even if a future attacker compromises the *user's wallet*, they can't decrypt yesterday's session because the receiver key is gone. |

### 4.2 What's NOT encrypted

The Cloudflare Worker Durable Object can see:
- That a `reqId` exists, when it was created, when it closed.
- The SDP offer/answer + ICE candidates (these contain only IP/port
  pairs and codec metadata — never the application payload).
- The fact that two peers connected to the room.

Cloudflare TURN (only when used as a relay; most connections are
direct P2P after ICE completes):
- The relayed bytes (which are NaCl-boxed ciphertext).
- The total bytes + duration.

Critically, **the application payload (the SD-JWT-VC + KB-JWT) is
never visible to any third party** — it's NaCl-encrypted to the
browser's ephemeral X25519 pk, and the data channel runs over DTLS
on top of that. Two layers of encryption, the inner one with a key
the relay infrastructure never sees.

The **per-domain rekey** (ARCHITECTURE.md §2.1) means the holder's
identity is unlinkable across sites — the same wallet signing into
two different domains looks like two different users to any
observer comparing `cnf.jwk` values.

## 5. Replay & freshness

| Threat | Defense |
|---|---|
| Replay a captured presentation **to the same verifier** | The KB-JWT's `nonce` is verifier-chosen; the SDK rejects any presentation whose nonce ≠ the in-flight request's nonce. |
| Replay a captured presentation **to a different verifier** | The KB-JWT's `aud` is bound to the verifier's `https://<domain>`. A different `aud` → verifier rejects. |
| Replay across **time** | KB-JWT `iat` is bounded to current ± 30 s by the SDK. The credential itself has `exp` ≤ 15 min. |
| Replay across **renewals** | Each renewal mints a new KB-JWT with a new `nonce` and `iat`; the SDK rejects monotonic-decreasing `iat`. |

## 6. Session revocation

There are **four** independent paths that kill a session immediately:

| Path | Initiator | What dies |
|---|---|---|
| User taps "Sign out" on the website | Browser → SDK | The SDK drops the cookie + emits `onExpiry("user_revoked")`. Prson server-side does not need to be touched. |
| User taps "Sign out everywhere" on the wallet | Mobile app → LiveKit data channel (`{msg:"revoke"}`) | All active sessions for this (identity, domain) tear down. SDK fires `onExpiry("wallet_signed_out")`. |
| **Credential is revoked** on the notary side (e.g. document alias-transferred away — see [`project_identity_sd_jwt_vc`](../mobile-app/prson_app/docs/trust_architecture.md#62-what-s-in-the-vc-vs-signed-on-demand)) | Server → wallet → browser | Wallet stops issuing renewals; browser session lapses at TTL. (A future status-list endpoint enables instant revocation.) |
| User loses the device | Mnemonic recovery on a new device → re-register → old device deauthorized | All sessions from the old device stop being renewable; they lapse at TTL. The mobile app on the new device sees the active-sessions list and can renew. |

## 7. The five rules a verifier MUST enforce

Lifting these out of the spec so they're a checklist:

1. **Resolve the issuer key by `iss`** — `did:web:app.prson.net` OR
   `https://app.prson.net/.well-known/jwt-vc-issuer`. Don't trust
   issuer keys from any other source.
2. **Verify the issuer JWS** (RSA-PKCS1v1.5-SHA256) — reject if it
   doesn't validate.
3. **Recompute every disclosure digest** and confirm each is present
   in the JWS's `_sd` array. Reject any disclosure whose digest isn't
   there (that's a forged disclosure).
4. **Verify the KB-JWT** — Ed25519 signature against `cnf.jwk` from
   the JWS payload, and:
   - `aud === "https://<your-domain>"`
   - `nonce === <the nonce you generated>`
   - `sd_hash === b64u(sha256(<presentation prefix without KB-JWT>))`
   - `iat` within the last 60 s.
5. **Check `exp`** on the issuer JWS payload — reject if expired.

The reference verifier in `packages/verifier-node/` does all five.

## 8. Crypto-agility

If we ever need to deprecate Ed25519 for KB-JWTs (no current plan):
the SD-JWT-VC spec allows multiple algorithms; we'd add the new
`alg` (e.g. `ML-DSA-65`) to `cnf.jwk` at issuance time and verifiers
would dispatch by header.alg. The notary side's RSA-2048 is on a
similar trajectory.

The protocol version `prson_vp_v1` in every envelope (see
[ARCHITECTURE.md §4.2](./ARCHITECTURE.md#42-livekit-data-channel-envelope))
gates wire-format upgrades the same way.

## 9. What we deliberately do NOT do

- **No SDK-side session cookies.** The SDK returns the verified
  credential to the host page and is done. Cookie management is
  the host site's job — best-practice is HTTP-only, SameSite=Strict,
  Secure, ≤ session TTL.
- **No telemetry phoning home.** The SDK does not transmit anything
  to Prson beyond the (unauthenticated, content-bound) call to
  `createLoginSession`. Once the LiveKit room is up, Prson is a relay.
- **No long-lived bearer tokens.** Every session is renewal-bound;
  there are no refresh tokens that survive a wallet logout.

## 10. Audit checklist (for an external review)

When this ships, we should commission a focused audit covering:

- [ ] X25519 keypair generation entropy in the browser.
- [ ] NaCl `box` library used (must be a reviewed implementation —
      we vendor [tweetnacl](https://github.com/dchest/tweetnacl-js) or
      [@stablelib/nacl](https://github.com/StableLib/stablelib)).
- [ ] HKDF derivation of per-domain Ed25519 keys cannot leak the
      identity-key seed (constant-time implementation, no observable
      side channels in the derivation worker).
- [ ] CSP / SRI for the SDK's hosted bundle.
- [ ] No way to coerce `aud` other than via the verifier's hostname.
- [ ] The five verifier checks in §7 are enforced in the reference
      verifier and in any partner code we ship samples of.
- [ ] The renewal path can't be triggered by anyone other than the
      wallet that signed in originally.
- [ ] Cloudflare Worker `draftToken` + `walletSessionToken` HMAC
      verify cleanly, reject on expired `exp` or mismatched role,
      and the HMAC secret has rotation playbook.
- [ ] Wallet's Ed25519 claim signature is verified on the canonical
      tuple `"prson-login-claim/v1\n" + reqId + "\n" + walletPkX +
      "\n" + ts + "\n" + domain` — version prefix protects against
      cross-protocol replay.
- [ ] `/session/claim` echoes `domain` back through the DO and
      rejects with `401 domain-mismatch` when the wallet signed for
      a different domain than the browser drafted.
- [ ] No TURN credentials are issued before /session/claim succeeds
      (verified by reading the Worker's `mintCloudflareTurnCreds`
      call site and confirming it's only inside `handleClaim`).
- [ ] IP rate-limit on /session/draft prevents anonymous draft-spam
      from exhausting Durable Object capacity; KV bucket auto-expires
      after 65 s.
