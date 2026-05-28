# Sign-in-with-Prson — security audit (2026-05-28)

> **Scope.** End-to-end review of the implemented sign-in flow: browser SDK
> (`@prson/login-sdk`), Cloudflare Worker signaling + Durable Object,
> wallet-side `LoginSessionService` + drawer + active-sessions tile, and
> the verifier-node verifier. Adversaries A1–A8 from
> [`SECURITY.md` §1](./SECURITY.md) are assumed; findings here are
> additions / refinements on top of that base.
>
> **Severity scale.** **Critical** = realistic exploit path, blocks
> production. **Material** = real concern, fix before public launch.
> **Minor** = theoretical / privacy nicety / hardening backlog.

---

## TL;DR — what to fix before shipping

| # | Finding | Severity | Status |
|---|---|---|---|
| **C-1** | No origin/HTTPS binding between the browser's `domain` claim and the actual page origin → phishing primitive | **Critical** | ✅ **FIXED** (2026-05-28) |
| **C-2** | Custom-scheme deep link (`prson://login/v1?…`) has no app-binding guarantee; any installed app can register the same scheme | **Critical** | ✅ **FIXED** (2026-05-28) |
| **M-1** | Worker secret `SIG_TOKEN_HMAC_SECRET` has no rotation/versioning playbook | Material | ✅ **FIXED** (2026-05-28) |
| **M-2** | Single-use draftToken not enforced — an attacker who steals one can hijack the browser WS role | Material | ✅ **PARTIAL** (2026-05-28) — role-token pinning closes forgery; XSS-exact-token replay needs the refresh-endpoint follow-up |
| **M-3** | KB-JWT `iat` skew tolerance ±60s but no clock-sync guard on the wallet | Material | ✅ **FIXED** (2026-05-28) |
| **M-4** | WebRTC SDP leaks the wallet's local IP to Cloudflare TURN unless `iceTransportPolicy: 'relay'` | Material | ✅ **FIXED** (2026-05-28) |
| **M-5** | Per-domain rekey is deterministic — a leaked mnemonic permanently de-anonymises every site the user ever visited | Material | ✅ **FIXED** (2026-05-28) — opt-in `ephemeralIdentity: true` for unlinkable mode; deterministic stays as the documented default |
| **m-1** | LoginSettingsService writes the dev-mode flag to plain SharedPreferences — readable by another app on a rooted device | Minor | OPEN |
| **m-2** | TURN credentials handed to wallet aren't bound to the specific peer | Minor | OPEN |
| **m-3** | No status-list propagation: a notary-revoked credential keeps working on the website until its TTL | Minor | OPEN |
| **m-4** | The active-sessions tile state is in-memory only — a wallet crash + restart silently signs the user out of every website | Minor | OPEN |

### Fix log — 2026-05-28

| Finding | Implementation |
|---|---|
| **C-1** | `handleDraft` in [signaling-worker/src/index.ts](./infra/signaling-worker/src/index.ts) rejects `POST /session/draft` when the `Origin` header host doesn't match `request.domain`. Returns `400 origin-required` if Origin is missing, `403 origin-domain-mismatch` on disagreement. |
| **C-2** | `buildDeepLinkUrl` in [packages/browser/src/index.ts](./packages/browser/src/index.ts) now emits `https://app.prson.net/login/v1?…`. `/login/v1*` added to the AASA at [mobile-app/web/.well-known/apple-app-site-association](../mobile-app/web/.well-known/apple-app-site-association). Android already uses `handle_all_urls` so no change there. The wallet's `LoginDeepLink.tryParse` already accepted both forms — back-compat is automatic. |
| **M-1** | New `SIG_TOKEN_HMAC_KEYRING` env binding with `{active, retired[]}` JSON. Tokens are kid-prefixed (`<kid>.<exp>.<role>.<HMAC>`). Verifier accepts any kid still in the keyring (active or retired within `validUntil`). Legacy 3-segment tokens still verify under `SIG_TOKEN_HMAC_SECRET` for in-flight back-compat. Rotation playbook in [scripts/cloudflare/login-secret.sh](../scripts/cloudflare/login-secret.sh) — `stage`, `rotate`, `prune`. |
| **M-2** | `SessionState.pinnedTokenHashes` in the Durable Object locks each role to the first-seen `sha256(token)`. Second WS upgrade for the same role with a different hash returns `401 role-token-pin-mismatch`. Defends against token forgery (e.g. compromised-but-rotated-out HMAC key) but does NOT block exact-token replay from XSS — that needs the refresh-token-endpoint design proposed in the audit, deferred. |
| **M-3** | **Claim-tuple v1 → v2 protocol bump: timestamp is now server-issued.** Worker stamps `serverTs = nowSec` at `/session/draft` and stores it in the Durable Object. Browser SDK relays it to the wallet via the QR's new `t=<serverTs>` param ([packages/browser/src/index.ts](./packages/browser/src/index.ts), [packages/browser/src/api.ts](./packages/browser/src/api.ts) `DraftResult.serverTs`). Wallet's canonical-claim-bytes are now `"prson-login-claim/v2\n<reqId>\n<walletPkX>\n<serverTs>\n<domain>"` ([login_envelope.dart](../mobile-app/prson_app/lib/core/utils/login_envelope.dart)). The `/session/claim` request no longer carries `ts` at all; signature verification moved **inside** the Durable Object, where the stored `serverTs` is read and the bytes reconstructed atomically with the DRAFT→ACTIVE promotion. The wallet never computes time, so clock-skew + replay-within-skew both vanish. ServerClock service was removed (the wallet-side approach is obsolete under v2). |
| **M-4** | `LoginWebRtcClient.connect` defaults to `iceTransportPolicy: "relay"`. Wallet's host + server-reflexive candidates are never gathered → never end up in the SDP exchanged through the Worker or at the browser. Opt-out via `allowDirectP2p: true` for advanced callers who accept the IP-exposure trade. |
| **M-5** | New SDK option `signIn({ ephemeralIdentity: true })`. Wallet generates a fresh random Ed25519 keypair per sign-in (no per-domain HKDF). Drawer surfaces "Fresh key per sign-in (no stable per-site id)" line so the user understands the trade-off. Deterministic per-domain remains the default; sites that want unlinkability opt in. |

What's **not** a finding (with rationale):

- ❌ Replay of a captured KB-JWT to a different verifier — already blocked by `aud` binding. ✓ Tested.
- ❌ Replay of a captured anonymous-wallet JWT — same; `aud` + `nonce` + short `iat` skew. ✓ Tested.
- ❌ Cloudflare reading the credential payload — NaCl `box` to the browser ephemeral key. The relay sees ciphertext only. ✓ By design.
- ❌ A second wallet racing to claim a draft — claim signature is per-identity-key; a second wallet's claim succeeds for itself but doesn't affect the first's session.

---

## C-1 Origin / HTTPS binding gap (CRITICAL)

### What's wrong

The browser SDK posts `request.domain = window.location.origin.replace(/^https?:\/\//, "")` to `POST /session/draft`. The Worker stores this verbatim and the wallet's KB-JWT binds `aud = "https://<domain>"`. **Nothing on the server side verifies that the claimed domain matches the actual TLS-terminated origin** of the HTTPS POST.

Attack: phisher hosts `bank-victim.evil` and embeds the SDK with `request.domain = "bank.com"`. The user scans the QR on their phone, the drawer renders "Sign in to bank.com?", the user approves, the wallet signs a presentation with `aud: "https://bank.com"`. The phisher's site receives the presentation (boxed to its own X25519 pk) and **forwards it to bank.com's backend** — which accepts it.

Why the existing anti-tamper doesn't help: the Worker's echo confirms "the browser session that drafted with reqId X claimed domain=bank.com" — but the **browser session was the phisher's**, who knowingly lied.

### Suggested fix — given our infrastructure

Add an **origin check** in `POST /session/draft` on the Cloudflare Worker. Workers receive the request's `Origin` header (browsers send it automatically for CORS) and the TLS-terminated hostname is in `request.headers.get("CF-Connecting-IP")` adjacent metadata via `request.cf.host`. Reject the draft when `request.domain` doesn't match `request.headers.get("Origin")`:

```ts
// In handleDraft, before storing the canonical request:
const originHeader = req.headers.get("Origin"); // e.g. "https://example.com"
if (!originHeader) {
  return jsonError(400, "origin-required");
}
const originHost = new URL(originHeader).host;
if (originHost.toLowerCase() !== body.request.domain.toLowerCase()) {
  return jsonError(400, "origin-domain-mismatch");
}
```

This kills the attack because the phisher's browser session sends `Origin: https://bank-victim.evil` but tries to claim `domain: bank.com`. Cost: blocks `null`-Origin contexts (file://, sandboxed iframes); the SDK README should call this out.

**Belt-and-suspenders**: also encode the verifier domain into the KB-JWT bound to a TLS cert chain extracted from a server-known DNS record (e.g. `_prson-vc.example.com` TXT). Heavy, deferred to v2.

---

## C-2 Custom-scheme deep link is not app-bound (CRITICAL)

### What's wrong

The QR currently encodes `prson://login/v1?…`. Custom URI schemes have **no cryptographic binding to an app** on either platform:

- **iOS**: if a malicious app declares the same `prson://` scheme in `Info.plist`, iOS picks based on install order / user-prompt heuristics. No mitigation.
- **Android**: app A's manifest can `<intent-filter>` for the same scheme; user is prompted to choose. A user under pressure clicks the wrong one.

A malicious app that intercepts a Prson login URL gets the `req` blob (containing `nonce` + `browserPk`). It can't sign a claim (no identity key) but it can:
1. Race to call `POST /session/claim` with a malformed wallet key (Worker rejects).
2. Show a fake "Login successful!" screen to the user while silently dropping the request, leaving the user's real browser stuck on a stale QR.
3. **Hijack the WS draft role** (see M-2 below) if the user has already drafted on the browser — the attacker connects as the browser using the leaked draftToken (which isn't in the QR but is in the SDK's HTML if reverse-engineered).

### Suggested fix — given our infrastructure

Switch the QR encoding to a **universal link** (`https://app.prson.net/login/v1?…`) and rely on the platform's cryptographic app-binding:

- iOS: Universal Links via `apple-app-site-association` (we already serve `/.well-known/apple-app-site-association` from `app-prson` hosting — confirmed in the existing firebase.json hosting rewrites).
- Android: App Links via `assetlinks.json` (same — already served).

Both are signed by the OS against our domain's TLS cert + the app's signing cert hash; **a malicious app cannot register a competing handler.**

Concrete changes:
1. Browser SDK `buildDeepLinkUrl()` emits `https://app.prson.net/login/v1?…` instead of `prson://login/v1?…`.
2. `LoginDeepLink.tryParse` already supports both forms — no wallet-side change.
3. Add `app.prson.net/login/*` to the `apple-app-site-association` + `assetlinks.json` allow-paths.
4. Deprecate the `prson://login/*` handler in the wallet over a two-release window (still parse for backward compat, log a warning, then remove).

For QR usage: most QR scanners on modern phones now invoke universal links directly (camera → tap notification → Prson app opens). Falls back to the browser when the app isn't installed → site can detect + show "install Prson" hint. Strictly better UX than the custom scheme.

---

## M-1 Worker HMAC secret has no rotation playbook

### What's wrong

`SIG_TOKEN_HMAC_SECRET` is the symmetric key that signs all draftToken + walletSessionToken HMACs. If it leaks, an attacker can mint tokens for any reqId. No code path supports rotating it without breaking in-flight sessions.

### Suggested fix — given our infrastructure

Mirror the notary keyring pattern ([`project_notary_keyring`](../mobile-app/prson_app/docs/trust_architecture.md)):

1. Worker secret becomes `SIG_TOKEN_HMAC_SECRETS_JSON` = `{ active: { kid, secret }, retired: [{ kid, secret, validUntil }] }`.
2. Token format gains a `kid` prefix: `<kid>.<exp>.<role>.<HMAC>`.
3. Mint with the active kid; verify accepts any kid whose `validUntil` is in the future.
4. Rotation: add a new active, set the old one to retired-with-validUntil-now+15min, deploy. In-flight sessions verify under the retired kid until they naturally expire.
5. Operate via `wrangler secret put` + a small `scripts/cloudflare/login-secret.sh stage|rotate|prune` similar to `scripts/notary/rotate.sh`.

Cost: ~30 LoC change in the Worker, one ops script. No client-side impact.

---

## M-2 draftToken / walletSessionToken are not single-use

### What's wrong

Once minted, a draftToken / walletSessionToken accepts ANY number of WS upgrades from anywhere with the value. Same role connections replace prior ones (4002 close) — so an attacker who steals the draftToken can kick the legitimate browser off the room and impersonate it. They can't decrypt (no X25519 sk on the browser side) or sign (no identity key) but they CAN inject SDP/ICE to wedge the negotiation, or replay-receive the wallet's encrypted envelope (no plaintext value — the X25519 sk is still on the legitimate browser).

The leak vector is realistic: the draftToken is returned by `POST /session/draft` and lives in the SDK's runtime state. XSS on the host page exfiltrates it.

### Suggested fix — given our infrastructure

Make role tokens **single-use** at the Durable Object level:

1. When the Worker accepts a WS upgrade for role X, mark `state.consumedRoleTokens[role] = tokenHash` in the DO.
2. Reject subsequent upgrades that present any token whose hash is in `consumedRoleTokens`.
3. Reconnect after a network blip becomes: caller fetches a fresh role token (server-side endpoint `/session/refresh-token` requiring proof of prior ownership — for the browser, the X25519 sk; for the wallet, a fresh Ed25519 signature).

Smaller drop-in if the full single-use change is too invasive: **bind the token to the User-Agent** — Worker rejects subsequent upgrades whose User-Agent doesn't byte-match the first. Cheaper, less robust (UA spoofing is trivial); deploy as a stop-gap while the proper single-use design lands.

---

## M-3 Wallet has no clock-sync safeguard

### What's wrong

The wallet computes `ts = DateTime.now().millisecondsSinceEpoch ~/ 1000` for the `/session/claim` signature. If the device clock is off by more than the Worker's `CLAIM_MAX_SKEW_SECONDS` (5 minutes), claims fail with a cryptic `ts-skew` error. Worse — if the user's clock is set back by 5+ minutes and an attacker captures a claim signature, they can replay it after the clock catches up (signature still verifies; ts is now within skew).

### Suggested fix — given our infrastructure

Two cheap additions in the wallet:

1. On app start, fetch `Date` header from `https://app.prson.net/` (or any HTTPS endpoint with `Cache-Control: no-store`) and compute `clockSkewMs = serverDate - Date.now()`. Cache for the session. Use `(Date.now() + clockSkewMs) / 1000` as `ts` in claim signatures.
2. The Worker can additionally accept (and prefer) a `serverNonce` from `/session/draft` that gets included in the claim canonical bytes. This binds the claim to a specific draft → no replay possible across drafts. Wire change: add `serverNonce` to the canonical claim tuple format → bump the version prefix to `prson-login-claim/v2`.

Recommend doing both. Together they make replay impossible and skew issues self-heal.

---

## M-4 WebRTC SDP leaks the wallet's local IP

### What's wrong

`flutter_webrtc` gathers host + server-reflexive + relayed ICE candidates by default. The host candidates expose the wallet's LAN IP; the srflx ones expose its public NAT-mapped IP. Both are visible to the Cloudflare Worker (in the SDP we relay through it) and to the browser (in the data-channel handshake).

A site that signs a user in repeatedly + correlates the IPs sees the user's home IP, work IP, mobile-network IP, etc. — even though the per-domain rekey makes the cnf.jwk unlinkable across sites, **the wallet's IP is the same**.

### Suggested fix — given our infrastructure

Make `iceTransportPolicy: 'relay'` the wallet-side default:

```dart
final pc = await createPeerConnection({
  'iceTransportPolicy': 'relay',  // force TURN, hide local IPs
  'iceServers': [
    { 'urls': turn['urls'], 'username': turn['username'], 'credential': turn['credential'] },
  ],
});
```

Cost: every login session uses TURN (~$0.0005/session at our usage profile vs. ~$0 for P2P) — still ~100× cheaper than LiveKit. Privacy gain is meaningful; the cost is rounding-error.

Optional: expose `LoginSettingsService.allowDirectP2p` (default false; advanced toggle) for users who want the cheaper P2P path despite the IP exposure. Symmetric with the dev-mode toggle.

---

## M-5 Per-domain rekey is permanently linkable on mnemonic compromise

### What's wrong

`cnf.jwk = Ed25519.fromSeed(HKDF(identitySeed, "prson-login-rekey/v1", domain))` is deterministic. If the user's mnemonic ever leaks (lost device, malware), an attacker with the mnemonic can re-derive every site's cnf.jwk and **historically de-anonymise** the user across every Prson login the user has ever done. Per-domain rekey only protects against PASSIVE cross-site correlators; it doesn't protect against retrospective deanonymization given the seed.

### Suggested fix — given our infrastructure

This is fundamentally a design trade-off: making the rekey ephemeral breaks "same user → same id on the same site," which is the whole point. Two mitigations:

1. **Document it explicitly** in [`SECURITY.md`](./SECURITY.md) §2 as part of the trust-model preconditions: "Per-domain unlinkability holds against passive observers; mnemonic compromise breaks both same-site continuity (the attacker can impersonate) AND cross-site unlinkability (the attacker can rebuild every cnf.jwk)."
2. **Optional ephemeral mode** as a flag the SDK can opt into: `signIn({ ephemeralIdentity: true })` skips the HKDF rekey + generates a fresh Ed25519 keypair per login. Same-user-twice gets a different id; sites that need a stable id can't use it, but for read-only "sign in to see a one-time view" use cases, it's the right primitive.

---

## m-1 LoginSettingsService writes plaintext

### What's wrong

The "Allow developer logins" flag is in `SharedPreferences` (plain on-disk). On a rooted Android device or a jailbroken iOS device, another app with elevated privileges can read it. Toggle the flag → the user's wallet now accepts localhost logins from any app's spawned local server.

### Suggested fix

Move the flag to `flutter_secure_storage` (already a wallet dep). One-line change in `LoginSettingsService`. Net effect: the flag is encrypted at rest with the device's Keychain / Keystore. Same SUDP API; transparent to callers.

---

## m-2 TURN credentials aren't peer-bound

### What's wrong

The Cloudflare TURN credentials minted on `/session/claim` are anonymous (Cloudflare doesn't tie them to a specific peer). If the wallet's claim response is logged (verbose telemetry, debug build), an unrelated party can use the credentials to relay arbitrary traffic on Prson's account for the 15-min TTL.

### Suggested fix

Two paths:

1. **Short TTL plus per-peer credential**: Cloudflare's TURN credential API supports `userIdentifier`. Set it to `reqId` (or a hash of it). Doesn't prevent re-use exactly but logs which session the credential was minted for, enabling abuse detection.
2. **TURN credential delivery via the encrypted channel**: instead of returning TURN creds in the `/session/claim` HTTPS response, have the Worker push them to the wallet over the wallet's WS connection, encrypted to a wallet-supplied X25519 pk (similar to the wallet-to-browser pattern). Heavier; deferred.

Path 1 is fine for v1.

---

## m-3 Notary revocation doesn't reach active sessions instantly

### What's wrong

When `revokeIdentityCredential` runs (e.g. alias-transfer resolver fires), the wallet stops issuing renewals — but websites with active sessions don't get notified. The session runs to TTL (up to 15 min) before lapsing.

For a stolen device scenario, 15 minutes is enough time to do real damage.

### Suggested fix

Add a **status-list endpoint** at the notary side. We already publish JWKS + DID at `/.well-known/jwt-vc-issuer` and `/.well-known/did.json`. Add `/.well-known/prson-vc-status/v1.json` returning a list of recently-revoked credential ids (sha256 of credId, last N days). Verifiers (the `@prson/login-verifier`) check against this list on each renewal. ~30 LoC change in the verifier package; ~15 LoC in `functions/api/identity-credentials.js` to materialize the list from `notary/identityCredentials/revoked/*`.

Mid-term, evolve to [OAuth Status Lists](https://datatracker.ietf.org/doc/draft-ietf-oauth-status-list/) for byte-efficient mass revocation.

---

## m-4 Active-sessions tile state is process-scoped

### What's wrong

`ActiveWebSessionsService._sessions` is in-memory only. A wallet crash, OS kill, or even a Flutter hot-restart wipes the list — but the *browser session* continues to live on whichever site, until its TTL elapses. The user has no way to renew or revoke from the wallet's perspective after this happens.

### Suggested fix

Persist the **session metadata** (domain, identityId, expiresAt, signalingWss, walletSessionToken) to `flutter_secure_storage` on every `add` / `remove`. On wallet cold-start, rehydrate the list, reconnect to each WS (the walletSessionToken is still valid until session expiry), and re-attach the `RTCPeerConnection`. The browser-side `peer-ready` re-handshake covers reconnection.

Cost: ~40 LoC in `ActiveWebSessionsService` + a small reconnect helper in `LoginSessionService`. Privacy: the secure-storage entries are encrypted at rest with the device keystore; the walletSessionToken expires within 15 min so the persisted state can never leak a credential.

---

## Things confirmed safe (with test references)

| Property | Reference |
|---|---|
| `aud` mismatch rejected | [sd_jwt_kb_test.dart](../mobile-app/prson_app/test/core/utils/sd_jwt_kb_test.dart) `buildAndSign → verify with real Ed25519 round-trip` |
| Disclosure tampering detected | [sd_jwt_present_test.dart](../mobile-app/prson_app/test/core/utils/sd_jwt_present_test.dart) `tampered Disclosure not bound` |
| Worker `/session/claim` Ed25519 signature verification | [signaling-worker/src/index.ts](./infra/signaling-worker/src/index.ts) `canonicalClaimBytes` |
| Browser openBox byte-compat with wallet pinenacl | [login_crypto_test.dart](../mobile-app/prson_app/test/core/utils/login_crypto_test.dart) `encryptToBrowser → browser openBox round-trip` |
| Anti-tamper QR: URL domain must agree with req-blob domain | [login_deep_link_test.dart](../mobile-app/prson_app/test/core/utils/login_deep_link_test.dart) `rejects when domain in URL disagrees` |
| Worker rejects MRZ-only credential issuance | [identityCredentials.test.js](../functions/test/services/identityCredentials.test.js) |

---

## Recommended remediation order

1. **C-1** (origin check on Worker) — ~10 LoC. Pure server-side. No client deploy needed.
2. **C-2** (universal-link migration) — DNS + manifest entry already exist; the SDK switch is one-line. Mobile parser already supports both forms. Deprecate custom scheme over two app releases.
3. **M-1** (HMAC secret rotation) — design + 30 LoC + an ops script. Ship before any wide rollout.
4. **M-4** (force TURN) — wallet-side one-liner. Privacy win, negligible cost.
5. **M-3 + clock skew** (claim-tuple v2 + clock fetch) — wire-breaking; bump `prson-login-claim/v1` → v2.
6. **M-2** (single-use role tokens) — design effort; medium implementation.
7. **m-1 / m-2 / m-3 / m-4** — backlog. None block production but all improve resilience.

After remediation, the protocol matches the security profile of mature SSO products (Sign-in-with-Apple, Auth0 magic links) at the credential layer, with significantly stronger transport privacy than either.
