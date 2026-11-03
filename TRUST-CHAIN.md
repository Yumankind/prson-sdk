# Trust chain and identity proof

> *How the verifier (the website) actually decides "this is the user
> they claim to be". Why the HMAC bearer doesn't gate identity. The
> design decisions behind each layer.*

This document is the single place to read end-to-end about what the
browser SDK trusts when `await PrsonLogin.signIn()` resolves. The
pieces are scattered across [ARCHITECTURE.md](./ARCHITECTURE.md) (wire
format), [SECURITY.md](./SECURITY.md) (adversary models), and
[SECURITY-AUDIT-2026-05-28.md](./SECURITY-AUDIT-2026-05-28.md) (audit
findings); this is the unified narrative + the design rationale for
why each layer is the way it is.

## 1. What the browser actually trusts

The wallet's first envelope on the WebRTC data channel carries a
`presentation` string — a compact SD-JWT-VC + KB-JWT:

```
<JWS>~<disclosure-1>~<disclosure-2>~ … ~<KB-JWT>
```

Three signatures stack inside that string:

| Layer | Signed by | What it proves |
|---|---|---|
| **Issuer JWS** (the VC body) | Prson notary key (RS256, kid in the keyring at `cloudflare-workers/api/src/lib/companyKeys.ts`; issued by the Prson API's `POST /v1/fn/issueIdentityCredential`) | The claims in the VC (`verified_human: 5`, `given_name: "…"`, `cnf: { jwk: <holder-pk> }`) are facts the notary attested to. The VC body carries no `aud`: the audience is bound by the KB-JWT |
| **Disclosures** | (none — content-addressed by hash) | Each disclosure has its SHA-256 digest in the JWS payload's `_sd[]` array. Selective disclosure: the holder reveals only the digests it chose; the verifier rehashes the revealed disclosures and matches against the array |
| **KB-JWT** (Key Binding) | Holder's per-domain Ed25519 (matches `cnf.jwk`) | **Proof-of-possession**: the user holding the private key right now signed this exact set of disclosures for this exact `aud`/`nonce` |

The compact form is exactly the SD-JWT-VC draft-08 / draft-09 wire
format — see [`packages/browser/src/verify.ts`](packages/browser/src/verify.ts)
for the verifier, [`mobile-app/prson_app/lib/core/utils/sd_jwt_present.dart`](../mobile-app/prson_app/lib/core/utils/sd_jwt_present.dart)
and [`sd_jwt_kb.dart`](../mobile-app/prson_app/lib/core/utils/sd_jwt_kb.dart)
for the wallet-side builder.

## 2. The five verification rules

`verifyPresentation` enforces five rules before `signIn()` resolves.
Failing any one rejects the credential with `verified.ok = false` and
a specific `reason` code.

1. **Issuer JWS signature verifies** against the trusted issuer's
   public key, fetched from `did:web:app.prson.net/.well-known/jwt-vc-issuer`.
   Anything signed by anyone else is rejected. *This anchors the
   entire chain to one root of trust.*

2. **`vct` is in the accepted list** — `verified-human/v1`,
   `verified-identity/v1`, and (only when the host opted in via
   `allowAnonymous: true`) `anonymous-wallet/v1`. Unknown VCTs are
   rejected without ever invoking the dispatcher.

3. **`aud` matches** the expected audience in the **KB-JWT** (the VC
   body has no `aud`; the KB-JWT is what binds a presentation to one
   site). A presentation made for `bank.com` will not verify on
   `evil.com`. The wallet signs a KB-JWT only for the domain it parsed
   from the deep-link payload, so forging `aud` requires controlling
   the wallet's signing call site.

4. **`nonce` matches** the one the browser put in the QR. The nonce
   is 32 bytes of `crypto.getRandomValues` minted per `signIn()`, so
   a captured presentation cannot be reused on a fresh sign-in.

5. **KB-JWT signature** verifies against `cnf.jwk` AND its `sd_hash`
   field equals SHA-256 of the disclosure-chain bytes. This is the
   teeth of proof-of-possession: the holder didn't just hand the SDK
   the VC, they signed *this exact selection of disclosures for this
   exact `aud`/`nonce`* with the matching private key right now.

If all five pass, the browser knows:

> *Someone who holds the private key corresponding to `cnf.jwk.x`
> (call them U) presented these claims, which the Prson notary
> previously attested were facts about U, to me, on this domain, for
> this sign-in attempt.*

## 3. Per-domain key derivation

The holder key (`cnf.jwk.x`) is **not** the user's root Prson
identity key. It's derived per verifier domain:

```
perDomainSeed = HKDF(identitySeed, info=domain)
perDomainKp   = Ed25519.fromSeed(perDomainSeed)
```

See [`login_per_domain_key.dart`](../mobile-app/prson_app/lib/core/utils/login_per_domain_key.dart).

Consequences:
- On `bank.com` the user is always the same `cnf.jwk.x` across
  sessions. The verifier treats this as the stable per-user id on
  its domain.
- The same person on `gym.com` shows up as a completely different
  `x` — no cross-domain correlation, no observer can link the two
  accounts.
- The verifier never sees the root identity key, so a per-domain key
  compromise (e.g. a verifier's database leak) cannot pivot to the
  user's other accounts.

### Ephemeral identity (M-5)

When `signIn({ ephemeralIdentity: true })` is passed, the wallet
generates a fresh random Ed25519 keypair per sign-in instead of the
deterministic per-domain key. Each session on the same site lands as
a *different* `cnf.jwk.x`. The trade-off is no stable per-user id on
that domain — best fit for read-only / single-use flows.

The session secret is persisted in the wallet's secure storage so a
return visit lands in the same anonymous account on the same device.
A different device cannot recover this account — there's no
mnemonic-derivation path. This is the explicit privacy contract.

## 4. The clean separation: transport auth vs. identity proof

Two completely independent layers, with completely independent keys
and threat models:

```
┌──────────────────────────────────────────────────────────────┐
│  Identity layer (cryptographic chain on the data channel)    │
│                                                              │
│  Notary RS256  →  VC body  ┐                                 │
│                            │ — Issuer JWS                    │
│                            │   verified by browser SDK       │
│  Holder Ed25519 → KB-JWT  ─┘                                 │
│                                                              │
│  Proves: who the user is, what's been notarised, that the    │
│  signer of the KB-JWT really is the holder.                  │
└──────────────────────────────────────────────────────────────┘
                            ⇡  ⇣  rides inside the channel
┌──────────────────────────────────────────────────────────────┐
│  Transport layer (the data channel itself)                   │
│                                                              │
│  HMAC-SHA256 over (reqId · role · exp)                       │
│                                                              │
│  ─── draftToken ────  browser → Worker WS upgrade            │
│  ─── walletSessionToken ─── wallet → Worker WS upgrade       │
│                            + /session/renew bearer           │
│                                                              │
│  Proves: this socket belongs to the session opened by reqId. │
│  Says nothing about who the human is.                        │
└──────────────────────────────────────────────────────────────┘
```

The browser SDK does not ever consult the HMAC token to identify the
user. The Cloudflare Worker doesn't sign identity claims — it just
authorises WS upgrades and the renewal endpoint.

Even if a leaked HMAC keyring secret let an attacker mint a valid
`walletSessionToken`, they still couldn't open a session that the
browser would trust — they'd need the notary's signing key (to forge
the VC) **and** the user's per-domain Ed25519 secret (to forge the
KB-JWT). The HMAC token sits at a strictly different layer.

This is why the M-1 keyring rotation in the Worker doesn't even
touch the SDK or the wallet's identity path: identity binding is
upstream of transport.

## 5. The HMAC token format

The HMAC token is **not a JWT**. It's a 4-segment dotted string:

```
<kid>.<exp>.<role>.<base64url(HMAC-SHA256(reqId + "\n" + role + "\n" + exp))>
```

Example: `2026-05.1748509100.wallet.kJq3…QkXY`

| Segment | Carries | Used for |
|---|---|---|
| `kid` | Keyring entry id (`"2026-05"`, `"legacy"`, …) | Tells the verifier which HMAC secret to use — supports rotation without invalidating in-flight tokens |
| `exp` | Epoch seconds | Hard expiry; rejected if `exp * 1000 < Date.now()` |
| `role` | `"browser"` \| `"wallet"` | Which peer this token authorises |
| `tag` | base64url HMAC-SHA256 | Authenticator |

Verification (see [`verifyRoleToken`](../cloudflare-workers/signaling-worker/src/index.ts)):

1. Split into 4 parts → `{ kid, exp, role, tag }`
2. Expiry check.
3. Role-vocabulary check.
4. Keyring lookup by `kid`. Retired entries still verify until their
   `validUntil` passes — that's how rotation works without breaking
   live sessions.
5. Reconstruct canonical bytes: `${reqId}\n${role}\n${exp}`. **Note:
   `reqId` is NOT in the token** — the caller supplies it from the
   URL path, so the token only verifies against the request it was
   minted for. A token replayed against a different session's URL
   silently fails.
6. Recompute HMAC; constant-time compare against `tag`.

### Design decision: why HMAC and not JWT

Worth the question — JWT is the obvious default. We chose HMAC:

| Property | HMAC choice | JWT alternative |
|---|---|---|
| **Layer** | Symmetric — only the Worker mints and verifies | Symmetric (HS256) or asymmetric (RS256/ES256) |
| **Who verifies** | Worker only. SDK + wallet treat as opaque bearer | Same |
| **Size** | ~80 bytes | ~250 bytes for an equivalent payload |
| **WS handshake budget** | Token rides in `Sec-WebSocket-Protocol`, which has a header-size budget. ~80 B fits comfortably | ~250 B starts to crowd the handshake |
| **`reqId` binding** | Not in the token — caller supplies via URL path, makes replay-to-different-URL impossible | Would have to live in the payload, leaking the binding into a parseable structure and inflating size |
| **No parsing surface** | One dotted-string format, four segments, no JSON, no header `alg` ambiguity | JOSE-style `alg` confusion attacks have been a recurring footgun |
| **Rotation** | `kid` segment + keyring with `validUntil` on retired entries (M-1) | Same machinery available, but more moving parts |

We don't need any of JWT's interoperability features — the token
never leaves the Worker's trust boundary. The HMAC string is the
*minimal* representation of "Worker-issued bearer for `(reqId,
role)` valid until `exp`", which is the entire contract.

## 6. Threat-model walkthroughs

For each attack class, where the chain breaks:

### 6.1 Phisher replays a captured presentation

Captured by network sniffing, browser extension, evil ISP, anything.

- Rule 4 fails: `nonce` was minted fresh for the new sign-in attempt
  and the captured presentation's KB-JWT was signed over the old
  nonce.

### 6.2 Phisher proxies a real presentation to a different domain

The classic "evil twin" attack — phisher's page asks the wallet to
sign in, then forwards the credential to a real-domain verifier.

- Rule 3 fails: the KB-JWT's `aud` is the domain the wallet signed
  for; a verifier expecting another audience rejects it. (The VC body
  carries no `aud`; the per-domain `cnf.jwk` also differs per site.)
- **Belt-and-suspenders**: the wallet refuses to mint a credential
  bound to any domain except the one in the deep-link payload, which
  the user sees on the wallet drawer before consenting. The Worker's
  C-1 Origin check (`origin == domain` on `/session/draft`) prevents
  a phisher from ever getting a draftToken for `victim.com` to begin
  with.

### 6.3 MITM swaps `cnf.jwk` mid-flight

Wants to substitute their own holder key so they can sign future
KB-JWTs / renewals.

- Rule 1 fails: the VC body is signed by the notary including the
  `cnf.jwk` field. Tampering invalidates the issuer JWS.
- Rule 5 fails: the KB-JWT signature was made with the *original*
  holder key, so it won't verify against the swapped `cnf.jwk`.

### 6.4 Stolen wallet device

Phone is lost or stolen with the user signed into the wallet.

- The per-domain Ed25519 secret never leaves the device's secure
  enclave / Android Keystore. The thief has the device but cannot
  exfiltrate the key.
- The mnemonic recovers the same keys on a fresh device, so the
  legitimate user can `pushCredentialRevoked("key_compromised")`
  from a recovered device, which the browser SDK observes as
  `credential_revoked` + `signed_out` immediately. Any in-flight
  session on the stolen device dies on the next renewal attempt
  (worker-side TTL is short by design).

### 6.5 Compromised Worker / HMAC secret leak

Attacker mints valid `walletSessionToken` strings.

- They still cannot open a session the browser trusts. They have no
  notary signing key (so no valid VC) and no per-domain holder
  secret (so no valid KB-JWT).
- They CAN open a WebRTC channel and push garbage envelopes, which
  the browser SDK ignores (decryption fails — they don't have the
  ephemeral X25519 keypair the browser minted in memory for this
  signIn() call).
- M-1 keyring rotation invalidates the leaked secret on a roll-over;
  M-2 role-pinning at the DO refuses a second valid token for the
  same role (so a stolen valid token competing with the legitimate
  peer fails the pin check).

### 6.6 Compromised notary key

The worst case: attacker can forge VC bodies for any user.

- Recovery is operational: rotate the notary keyring
  ([`scripts/notary/rotate.sh`](../scripts/notary/rotate.sh)),
  publish the new DID document at
  `app.prson.net/.well-known/jwt-vc-issuer`, retire the old key.
  Browser SDK refetches the JWKS on next sign-in and rejects
  signatures under the retired kid.
- An attacker still needs the per-domain holder secret to make the
  KB-JWT verify — *forging the VC alone is not enough* to land a
  session on a verifier. This is the genuine teeth of the
  proof-of-possession requirement.

## 7. What identifies the user on the verifier

After `signIn()` resolves, the verifier sees:

```ts
{
  cnf: { jwk: { kty: "OKP", crv: "Ed25519", x: "ABcd…" } },
  claims: {
    verified_human: 5,
    // …whatever disclosures the user chose to reveal
  },
  credential: {
    vct: "https://app.prson.net/credentials/verified-human/v1",
    iss: "did:web:app.prson.net",
    kid: "2026-05",
    expiresAt: 1748509100
  }
}
```

`cnf.jwk.x` is the **stable per-user identifier on this domain**.
Verifiers typically key their account records off this string. Two
sessions for the same person on this site will carry the same `x`;
the same person on a different site will carry a different `x`.

When ephemeral identity is used (M-5), `cnf.jwk.x` is fresh per
sign-in and the verifier needs another mechanism (user-chosen
username, etc.) to thread an account across return visits. The
SD-JWT-VC itself still proves the claims under the ephemeral key —
just no longer a stable handle.

## 8. Out-of-band protections (defence in depth)

Not part of the cryptographic chain but worth listing because they
narrow the attack surface before the cryptography ever runs:

- **Universal-Link deep-link** (`https://app.prson.net/login/v1?…`)
  rather than a custom URI scheme. Apple AASA / Android assetlinks
  bind the handler to the Prson wallet signing-cert hash; a
  malicious app cannot register a competing handler.
- **`iceTransportPolicy: "relay"` on the wallet** (audit M-4) so
  the wallet's local + NAT-mapped IPs never appear in the SDP
  exchanged through the Worker.
- **TURN-only on both peers** by default; no candidate leaks even
  on a friendly NAT.
- **DRAFT auto-expiry** (3 min) and short **session TTL** (currently
  2 min for testing, ~15 min production target) bound the window any
  captured artefact has to be useful.
- **Concurrency guard on `signIn()`** so a double-click can't spawn
  two parallel flows whose QR cards stack.

## 8b. Proof verdicts: what Prson vouched for, offline

Outside sign-in, Prson countersigns each truth proof (a capture, a fact,
a property's value, a document's fields) with a **verdict envelope**,
RS256 with the notary key over its canonical JSON (keys sorted at every
level, no whitespace), as `{ envelope, signature, kid }`. Scope
`prson-truth-verdict/2`:

```json
{
  "scope": "prson-truth-verdict/2",
  "proofId": "…", "type": "fragment | property | document | photo | …",
  "captureHash": "…", "artefactHashes": { … } ,
  "challengeId": "…", "slotId": "…",
  "signerIdentityId": "… (an org's pairwise respondent_id)",
  "level": "strong | weak | failed", "verifiedAt": "ISO-8601",
  "disclosures": [ { "kind": "fact | property | document_field", "id": "…", "digest": "…" } ]
}
```

`disclosures` commits to each disclosed value, SD-JWT style: Prson
makes 16 random bytes of salt per value when it signs, and
`digest = base64url(SHA-256(canonicalJson([salt, kind, id, value])))`.
`id` is the fact's fragment id, the property type, or the document field
name (`document_type`, `issuing_country`, `expires_on` and the chosen
chip fields). Whoever receives a value also receives
`[salt, kind, id, value]` (`verdict_disclosures` in the REST API and
webhooks, `verdictDisclosures` in proof packages and challenge answers).
To check a value: verify the signature against Prson's keys
(`GET /v1/company/public-key` or `/.well-known/jwks.json`), recompute the
digest and find it in `disclosures` under the same kind and id. Keep the
three together and anyone can later prove, offline, that Prson vouched
for exactly those values. The envelope alone reveals no value (the salt
makes it unguessable); a property shared without its value has no entry;
a capture's list is empty. `verifyVerdict()` in
`@prson/login-verifier` does this.

## 9. Reading paths

- *I'm a verifier integrator and want to know what to trust*: §1 →
  §2 → §7.
- *I'm a security auditor*: §2 → §4 → §6 → cross-reference with
  [SECURITY.md](./SECURITY.md) and [SECURITY-AUDIT-2026-05-28.md](./SECURITY-AUDIT-2026-05-28.md).
- *I'm wondering "why did you pick X"*: §3 (per-domain HKDF), §4
  (layer separation), §5 (HMAC vs JWT).
- *I'm a wallet engineer*: §1 → §3 → §6 (where the wallet's mistakes
  would cascade).
- *I hold a proof verdict and want to check what it vouches for*: §8b.
