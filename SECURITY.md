# Security — Prson Login SDK

> Threat model, crypto rationale, and the failure modes the SDK is
> designed to make impossible. Read alongside
> [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## 1. Adversaries we model

| # | Adversary | Capability | What they want |
|---|---|---|---|
| A1 | **Phisher running a clone site** | Renders a fake login page with their own SDK call; controls the domain shown in the URL bar. | Trick the user's wallet into binding a presentation to *their* `aud`, so they can replay it elsewhere. |
| A2 | **MitM at the Cloudflare relay** (Worker signaling layer, TURN relay when used) | Sees every byte traversing the signaling WS + any TURN-relayed packets; can drop, reorder, or inject. | Read the disclosed claims; replay; downgrade. |
| A3 | **Hostile other tab / extension** | Same-origin JavaScript on the legitimate site; OR a malicious extension with `<all_urls>` permission. | Steal the X25519 secret key, the SD-JWT-VC, or the session token. |
| A4 | **Stolen / unlocked phone briefly** | Has the mobile app open for ≤ 60 s. | Approve a login they didn't initiate. |
| A5 | **Compromised Prson server** | Can mint Worker draftTokens + TURN credentials, see signaling metadata, but cannot forge the **notary RSA key** (HSM-resident in prod). | Approve fake VCs (caught: bad issuer signature), or trick the SDK into a fake session (caught: see §3). |
| A6 | **Long-term offline attacker** | Records the entire signaling + relay traffic now, attacks later. | Decrypt past sessions. |
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

### 3.1 Relayed codes and first-claimer-wins (QRLjacking) — mitigated, not solved

The checks above stop a *tampered* code. They don't stop a *genuine* one
shown in the wrong place. A phisher can open `legit-bank.com` on their own
machine, take the real QR it shows, and display it on `phisher.evil`. The
victim scans it, sees `legit-bank.com` (correctly) and approves — and the
session lands in the phisher's browser. Likewise anyone who can see a QR
(shoulder-surfing, screen share) can scan it first: the relay gives the
session to whoever claims it first.

There is no cryptographic fix for this in a QR flow (the phone can't see
which browser shows the code). What we do:

- **The wallet claims the code as soon as the sheet opens** and the relay
  answers with where the browser that made the code is
  (`requester: { country, city, region, asn, as_org, hosting, browser,
  seen_at }`). The sheet shows it under the site ("Requested from Chrome on
  macOS, Lisbon, Portugal").
- **Risky requests get a different sheet**: when the code came from a data
  centre (`hosting`), from another country than the phone's region (OS
  setting; skipped when unknown), or the site is new to this phone, the
  warning is raised, "Don't sign in" becomes the main button, and signing in
  asks first: *"Is this code on `<domain>` in your browser's address bar?"* —
  "No" stops and explains.
- **A 409 from the relay** ("already claimed") makes the sheet say "Someone
  else already scanned this code. Don't continue; reload the page on your
  computer." and offers only Close.
- **The page shows who signed in.** The browser shows "scanned" as soon as
  any phone claims the code, and sites should show the signed-in identity
  (`SignInResult.prsonId` / the `signed_in` event) right away, so a stranger's
  sign-in is visible.
- **Secrets stay on the page.** The SDK never sends password or one-time-code
  field values over the live channel (`type=password`, `autocomplete`
  `current-password` / `new-password` / `one-time-code`): `bindInput`
  refuses them, `bindForm` and remote navigation skip them.

Residual risk: a careful phisher on a residential network in the victim's
country, against a site the victim has used before, still gets the plain
sheet; an inattentive user who answers "Yes" still signs the phisher in.
Future work: a proximity check (e.g. the phone and the browser proving
they're near each other — BLE, ultrasound, or a short code typed on the
page) would close it.

## 4. Encryption-at-rest-in-transit

### 4.1 NaCl `box` for the data-channel payload (envelope v2)

Both sides hold one X25519 key for the session, fresh for each sign-in and
kept only in memory:

- `browserSk/browserPk` — made by the SDK at `signIn()`; `browserPk` is in
  the QR.
- `walletSessionSk/walletSessionPk` — made by the wallet for the session;
  `walletSessionPk` is **signed into the presentation** by the holder key:
  the KB-JWT claim `prson_wsk` (or the anonymous credential's payload
  `prson_wsk`).

```
wallet → browser:  ct = box(walletSessionSk → browserPk, nonce24, plaintext)
browser → wallet:  ct = box(browserSk → walletSessionPk, nonce24, plaintext)
wire:              { ephPk: <sender's session pk>, nonce24, ct }   // field name kept
nonce24            random per message (XSalsa20's 192-bit nonce makes that safe)
```

The browser decrypts the first envelope, verifies its presentation, and
requires the envelope's sender to be the signed `prson_wsk`. From then on it
**pins** that key: an envelope that isn't boxed by it is dropped. A
`walletSessionPk` field on an envelope is never trusted; the pinned key
changes only when a verified `renewal` presentation (same holder key,
strictly newer `iat`) signs a new `prson_wsk` — that renewal is boxed by
the old key, later envelopes by the new one. A wallet whose request blob
says `envelopeVersion: 2` likewise accepts only envelopes boxed by
`browserPk`.

Properties:

| Property | How it's achieved |
|---|---|
| **Confidentiality** (A2) | XSalsa20 stream cipher under a 256-bit key. |
| **Integrity** (A2) | Poly1305 authenticator over the ciphertext. |
| **Sender authentication** (A2 injection) | NaCl `box` between two static session keys is mutual: only the holder of `walletSessionSk` can make a box that opens with `walletSessionPk`, and the browser learns which key to expect from the holder-signed presentation, not from the wire. A relay (or anyone who saw the QR and so knows `browserPk`) can't inject `nav` / `value` / `mouse-update` / `logout` / `revoke`, or swap the key the page sends focused-field values to. Browser → wallet is authenticated the same way with `browserPk`. |
| **Forward secrecy** (A6) | Per session, not per message: both session secrets live only in memory for one sign-in and are discarded at the end (page unload / session close). A leaked session key exposes that one session, never an earlier or a later one. |

**Older builds.** An SDK that predates v2 boxes with a fresh key per
message (the wallet opens it; it can't check the sender). A wallet that
predates v2 boxes with a fresh key per message and signs no `prson_wsk`:
the current SDK still signs the person in but runs a *legacy* session —
inbound senders can't be checked, so `nav`, `value`, `mouse-update` and
file-transfer envelopes are ignored and a console warning asks for an
app update.

### 4.2 What's NOT encrypted

The Cloudflare Worker Durable Object can see:
- That a `reqId` exists, when it was created, when it closed.
- The SDP offer/answer + ICE candidates (these contain only IP/port
  pairs and codec metadata — never the application payload).
- The fact that two peers connected to the room.

Cloudflare TURN (always: both peers are relay-only — the wallet since
M-4, the browser since envelope v2 — so neither side's IP addresses reach
the other):
- The relayed bytes (which are NaCl-boxed ciphertext).
- The total bytes + duration.

Critically, **the application payload (the SD-JWT-VC + KB-JWT) is
never visible to any third party** — it's NaCl-encrypted to the
browser's ephemeral X25519 pk, and the data channel runs over DTLS
on top of that. Two layers of encryption, the inner one with a key
the relay infrastructure never sees.

The **per-domain rekey** (ARCHITECTURE.md §2.1) means the holder's
`cnf.jwk` differs on every site — two sites comparing `cnf.jwk` values
can't tell they have the same person. That is not unlinkability against
every observer: the relay sees each sign-in's domain, the browser's and
the phone's network addresses (TURN), and timing. What it does **not** see
is any stable wallet key: `/session/claim` is signed by a fresh random
Ed25519 key per login (the relay accepts any key), and nothing else the
wallet sends the relay is stable across logins.

## 5. Replay & freshness

| Threat | Defense |
|---|---|
| Replay a captured presentation **to the same verifier** | The KB-JWT's `nonce` is verifier-chosen; the SDK rejects any presentation whose nonce ≠ the in-flight request's nonce. |
| Replay a captured presentation **to a different verifier** | The KB-JWT's `aud` is bound to the verifier's `https://<domain>`. A different `aud` → verifier rejects. |
| Replay across **time** | KB-JWT `iat` must be within ± 60 s of the verifier's clock (browser SDK `maxKbAgeSeconds` and verifier-node `maxKbJwtAgeSeconds`, both default 60). The credential itself has `exp` ≤ 15 min. |
| Replay across **renewals** | Within a session the SDK accepts a `renewal` / `claim-update` only if it verifies against the same holder key, its `iat` is **strictly greater** than the last accepted presentation's (the sign-in's, at first), and the presentation (SHA-256) was never accepted before. The renewal's nonce is the wallet's (today the sign-in nonce again), so a backend can't treat a renewal as fresh proof for its own nonce. |

## 6. Session revocation

There are **four** independent paths that kill a session immediately:

| Path | Initiator | What dies |
|---|---|---|
| User taps "Sign out" on the website | Browser → SDK | The SDK drops the cookie + emits `onExpiry("user_revoked")`. Prson server-side does not need to be touched. |
| User taps "Sign out everywhere" on the wallet | Mobile app → WebRTC data channel (`{msg:"revoke"}`) | All active sessions for this (identity, domain) tear down. SDK fires `onExpiry("wallet_signed_out")`. |
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
   - `iat` within ± 60 s of now (the reference verifiers' default).
5. **Check `exp`** on the issuer JWS payload — reject if expired.

The reference verifier in `packages/verifier-node/` does all five.

## 8. Crypto-agility

If we ever need to deprecate Ed25519 for KB-JWTs (no current plan):
the SD-JWT-VC spec allows multiple algorithms; we'd add the new
`alg` (e.g. `ML-DSA-65`) to `cnf.jwk` at issuance time and verifiers
would dispatch by header.alg. The notary side's RSA-2048 is on a
similar trajectory.

The protocol version `prson_vp_v1` in every envelope (see
[ARCHITECTURE.md §4.2](./ARCHITECTURE.md#42-webrtc-data-channel-envelope))
gates wire-format upgrades the same way.

## 9. What we deliberately do NOT do

- **No SDK-side session cookies.** The SDK returns the verified
  credential to the host page and is done. Cookie management is
  the host site's job — best-practice is HTTP-only, SameSite=Strict,
  Secure, ≤ session TTL.
- **No telemetry phoning home.** The SDK does not transmit anything
  to Prson beyond the (unauthenticated, content-bound) call to
  `POST /session/draft`. Once the WS to the Cloudflare Worker is up,
  Prson is a relay; once WebRTC connects directly, even the Worker
  drops out of the data path.
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
      tuple `"prson-login-claim/v2\n" + reqId + "\n" + walletPkX +
      "\n" + serverTs + "\n" + domain` — version prefix protects against
      cross-protocol replay; `walletPkX` is a per-login random key.
- [ ] `/session/claim` echoes `domain` back through the DO and
      rejects with `401 domain-mismatch` when the wallet signed for
      a different domain than the browser drafted.
- [ ] No TURN credentials are issued before /session/claim succeeds:
      the draft response carries none, and the browser gets its TURN
      servers over the socket (`{"type":"ice"}`) only after a claim.
      A leaked QR still lets a stranger claim it (and so mint TURN
      for that one session) — see §3.1; drafts are IP rate-limited.
- [ ] The browser drops data-channel envelopes not boxed by the pinned
      `prson_wsk` key, and pins it only from a verified presentation.
- [ ] `peer-gone` / `error` on the signaling socket never tear down a
      live data channel by themselves (the SDK waits for the channel to
      go silent).
- [ ] IP rate-limit on /session/draft prevents anonymous draft-spam
      from exhausting Durable Object capacity; KV bucket auto-expires
      after 65 s.
