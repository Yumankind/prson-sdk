# Changelog

All notable changes to the login SDK packages (`@prson/login-sdk`,
`@prson/login-sdk-ui`, `@prson/login-verifier`, `@prson/login-cli`).
Versions follow SemVer; while on 0.x, minor versions may break the API.

## Unreleased — Sign in with Prson channel hardening

Needs a relay that sends `{"type":"ice"}` after the claim (older relays
that put `turn` in the draft response still work) and a Prson app with
envelope v2 for the full protection.

### `@prson/login-sdk` (browser)

- **Envelope v2 (sender-authenticated).** The SDK pins the wallet's X25519
  session key from the verified sign-in presentation (new KB-JWT claim
  `prson_wsk`; for anonymous credentials, a payload claim of the same name)
  and drops any data-channel envelope not boxed by it; `walletSessionPk` on
  an envelope can no longer swap the key. Only a verified renewal carrying a
  new `prson_wsk` rotates it. Browser → wallet envelopes are now boxed by the
  browser's session key (`browserPk`). The request announces
  `envelopeVersion: 2`. Apps that predate it get a legacy session: sign-in
  works, `nav` / `value` / `mouse-update` / file envelopes are ignored.
- **Renewal anti-replay:** a renewal or claim-update must carry a strictly
  newer holder-signed `iat` and must not repeat an accepted presentation.
  Anonymous sessions can now renew (the session keeps the sign-in's
  accepted credential types).
- **Relay-only WebRTC after the claim:** the browser waits for the relay's
  `ice` message and builds its peer connection with
  `iceTransportPolicy: "relay"` and no STUN; "scanned" shows as soon as a
  phone claims the code.
- **Passwords and one-time codes never cross the channel:** `bindInput`
  refuses them, `bindForm` and remote navigation skip them, and `input`
  requests drop a password's `defaultValue`.
- `peer-gone` no longer tears down a data channel that is still talking.
- New: `session.prsonId`, `session.walletSessionPk` and `isSensitiveField()`.
  Sites should show who is signed in.

### `@prson/login-verifier`

- No change needed: unknown KB-JWT claims (`prson_wsk`) are ignored.

## 0.1.0

First npm release, under the Apache License 2.0. The browser bundles are
also served from `https://prson.net/vendor/prson-login/prson-login.js`
and `…/prson-login-ui.js`. The Node packages need Node 20 or later.
`@prson/login-verifier` now uses `jose` 6. Sign-in and verification results
carry `prsonId`, the person's stable ID for your site (the same value as
`cnf.jwk.x`, under a clearer name).

### `@prson/login-sdk` (browser)

- `PrsonLogin.signIn()`: Sign in with Prson. Cross-device (QR code,
  end-to-end-encrypted WebRTC with an HTTPS fallback) and same-device
  (deep link) flows; returns an SD-JWT VC presentation with key binding
  to your nonce and domain.
- Requirements: a minimum verification level, predicates such as
  `age_gte_18`, and optional anonymous-wallet credentials.
- Live sessions (`PrsonLoginSession`): renewal, expiry and lifecycle
  events, and the request channel (`session.request()`, `bindInput`,
  `bindForm`, `bindMouse`, `enableRemoteNavigation`).
- In-browser presentation checks, including `typ` (`dc+sd-jwt` or
  `vc+sd-jwt`), `exp` and Token Status List revocation.
- Website notifications: opt in at sign-in (`notifications: true`);
  `NOTIFY_HANDLE` and `notifyHandleFrom()` read the handle.
- Verifications ("sign this PDF", "prove you're 18"):
  `awaitVerification()` waits for an organisation's request to be
  answered.
- `PrsonLogin.restore()` is a placeholder that resolves `null` (no
  state is kept across page loads).

### `@prson/login-sdk-ui`

- Side-effect import that registers the QR renderer: the "Sign in with
  Prson" button and branded sign-in dialog, a themed QR card with TTL
  countdown and refresh, and readable descriptions of what is shared.

### `@prson/login-verifier` (Node)

- `verifyPresentation()`: issuer signature (RS256, `did:web:app.prson.net`
  keys), `typ`, `vct`, `exp`/`nbf`, disclosures, key binding (audience,
  nonce, freshness, `sd_hash`) and revocation via the issuer's Token
  Status List (`checkCredentialStatus()`, fail-closed for verified
  humans by default).
- Predicate facts: `verifyFragmentCredential()` (VC Data Model 2.0
  `vc+jwt`, or SD-JWT VC `dc+sd-jwt`) and `verifySignedFragment()`
  (Prson's native format), with audience binding.
- `verifyUniqueHumanId()`: one unique, document-verified human per
  domain (pairwise id).
- `verifyVerdict()`: Prson's signed proof verdicts
  (`prson-truth-verdict/2`, salted value digests).
- Website notifications: `readNotifyHandle()`, `sendNotification()`.

### `@prson/login-cli` (Node)

- Sign in from terminal programs: `startCliLogin()`,
  `createFactsRequest()` (delivery-pinned `/request/v1` links),
  `renderQr()`, short user codes and `pollForResponse()`.
