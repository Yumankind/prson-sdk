# Sign in with Prson **Identity** — design

> Design doc for the next layer on top of the existing "Sign in with
> Prson" flow. The base SDK already proves "a verified human holding
> this wallet just authenticated to this origin." This doc covers what
> changes when a host wants to bind to a **specific, named Prson
> identity** (one of several the user owns), and optionally pull in
> document-level facts (legal name, birthdate, nationality, …) from
> the same wallet without doing a second credential exchange.

> Status: design only. Companion to [`ARCHITECTURE.md`](./ARCHITECTURE.md)
> and [`TRUST-CHAIN.md`](./TRUST-CHAIN.md); supersedes neither. No code
> in `packages/*` implements this yet — see "Implementation phases"
> below for the smallest viable cut.

---

## 1. Why a second flavour?

The current `signIn()` resolves to:

```ts
{
  cnf: { jwk: { kty: "OKP", crv: "Ed25519", x: "<per-domain x>" } },
  claims: { verified_human: <level>, verification_level: "...", ... },
  credential: { vct: ".../verified-human/v1", iss: "did:web:app.prson.net", ... }
}
```

It proves *"some verified human"* without revealing which one. That's
correct for an account-creation prompt or an anonymous gate ("only
real humans past this line"). It's wrong for any of:

1. **Multi-identity users.** A wallet can hold several
   [DerivedIdentity]s — a personal one, an org they represent, an
   alias. Today the wallet picks one silently (the active one). A
   host that has a per-identity account model needs the user to
   choose, and to *know which identity signed in* — `cnf.jwk.x`
   alone doesn't carry that.
2. **Document-bound claims.** Some hosts (banks, gov-portal
   integrations, regulated marketplaces) need legal name + birthdate
   + document number, not just "is human." Today they'd have to do a
   second credential exchange after sign-in. With identity sign-in,
   the wallet can present the relevant [verified-identity/v1] VC in
   the same KB-JWT-bound presentation.
3. **Recognised name on the host UI.** "Welcome back, **Maria** ✦"
   instead of a hex string. Requires a stable, holder-disclosable
   identity handle.

The existing flow stays the canonical default — minimum disclosure,
no PII traversal. Identity sign-in is **opt-in** on both sides
(integrator requests it; user confirms in the wallet).

## 2. Wire shape (delta from `verified-human` sign-in)

Everything in [`ARCHITECTURE.md` §2] (Worker, DO, NaCl box, WebRTC,
TURN) stays identical. The only changes are inside the encrypted
data-channel payload + the issuer-side credential family.

### 2.1 New presentation envelope

The wallet posts the same SD-JWT-VC compact form as today, but the
issuer JWS payload has:

```jsonc
{
  "iss": "did:web:app.prson.net",
  "vct": "https://app.prson.net/credentials/verified-identity/v1",  // ← change
  "sub": "<per-domain identity sub>",                                // ← new
  "cnf": { "jwk": { "kty": "OKP", "crv": "Ed25519", "x": "<per-domain x>" }},
  "iat": <unix>,
  "exp": <unix>,
  "_sd_alg": "sha-256",
  "_sd": [ "<sha256(disclosure)>", ... ],
  // Unsealed metadata for verifier UX:
  "verification_level": 6,
  "issuing_chain": ["mrz", "nfc", "face-match"]
}
```

Disclosures attached as `~`-suffixes (per IETF SD-JWT-VC) for the
claim set the integrator asked for **and** the user approved in the
wallet:

```
given_name, family_name, birthdate, nationalities,
document_number, document_type, document_expiry_date,
issuing_country, place_of_birth, address, …
```

The mobile side already builds this in
[`identity_credential_service.dart#exportIdentityPresentation`] —
identity sign-in routes the same call through the WebRTC channel
instead of the OS share sheet.

### 2.2 Per-domain `sub` derivation

`sub` is a **stable, per-domain identity handle** — same value every
time identity `I` signs in to origin `O`, distinct from any other
origin. Derived in the wallet via:

```
sub = b64u( HKDF-SHA256(
  ikm  = identityRootSecret(I),
  salt = "prson-login-sub-v1",
  info = origin || ":" || identityId(I),
  L    = 32
))
```

Two wallets that mnemonic-recover the same identity produce the same
`sub` on the same origin. Two distinct origins see uncorrelatable
`sub` values for the same human (the existing per-domain rekey for
`cnf.jwk.x` extends to `sub`). The Prson server does **not** learn
this value — it's computed on-device and embedded in the holder's
presentation before encryption.

> Why per-domain instead of global? Cross-origin linkability is the
> single biggest privacy regression we'd take if `sub` were a real
> identity id. The host who wants global recognition can ask for the
> displayable handle (§2.3) as a disclosed claim — that's an active
> consent moment, unlike a passive identifier.

### 2.3 Optional disclosed "handle"

The wallet exposes one more selectively-disclosable claim:

```
"identity_handle": "Maria Z."   // user-editable display name
```

Verifiers SHOULD render it in their welcome UI. It carries no
authority — it's a human-readable label the holder chose. The
authoritative subject is still `sub` + `cnf.jwk.x`.

### 2.4 KB-JWT — unchanged

`aud`, `nonce`, `sd_hash`, `iat`, EdDSA sig by `cnf.jwk`. Same as
[`ARCHITECTURE.md` §3.4]; same verifier check at
[`verifier-node/src/index.ts#verifyPresentation`]. No new
proof-of-possession mechanism.

## 3. Browser SDK API delta

### 3.1 `signIn` opts

```ts
signIn({
  audience: "https://acme.example",
  nonce,
  // existing:
  allowAnonymous?: boolean,
  // new:
  request?: {
    identity: "any" | "named",          // "named" ⇒ surface VCT below
    vcts?: readonly string[],           // override accepted VCT list
    disclose?: readonly string[],       // claim names to request
    handle?: "optional" | "required",   // ask the user for a display name
  },
});
```

`request: { identity: "named", disclose: ["given_name","family_name"] }`
asks the wallet to choose a Prson identity and reveal first + last
name. If the user declines, the SDK rejects with
`PrsonLoginUserDeclined` (typed); the host falls back to whatever
identity-less flow it likes.

### 3.2 `signIn` resolved value

```ts
{
  // Subject identification:
  subject: "<per-domain sub>",                      // ← from §2.2
  cnf:     { jwk: { kty, crv, x } },                // unchanged

  // Disclosed claims (only the ones the user approved):
  claims: { given_name: "Maria", family_name: "Z.", ... },
  identityHandle?: "Maria Z.",                      // when requested
  disclosedClaimNames: ["given_name", "family_name"],

  // Credential envelope metadata:
  credential: {
    vct:        "https://app.prson.net/credentials/verified-identity/v1",
    iss:        "did:web:app.prson.net",
    kid:        "2026-05",
    iat:        1748509100,
    expiresAt:  1748512700,
    verificationLevel: 6,
  }
}
```

The host stores `subject` keyed on `(origin, subject)` — that's the
account. `cnf.jwk.x` is still bound (use it to gate session-cookie
replay just like today).

## 4. Mobile UX

A new "Sign in to *acme.example*" sheet sits between the QR scan and
the existing one-line consent. It lists:

- The host's `audience` (matched to the QR'd request).
- Which **identity** to sign in as (Cupertino picker — bypassed when
  only one human identity exists). Org identities only appear if
  `request.identity === "named"` AND the host's `vcts` list includes
  the org VCT (TBD; out of scope here).
- The **disclosure preview**: every claim the verifier asked for, with
  a check the user can untoggle. Matching today's behaviour from
  [`identity_share_screen.dart`].
- The optional `identity_handle` field, prefilled from the active
  identity's display name. Editable.

The user can untoggle any claim. The wallet records the final set and
calls `exportIdentityPresentation` with it. Anything the user refused
that was marked `required` aborts the sign-in with
`PrsonLoginUserDeclined`; everything else just doesn't appear in the
disclosures.

## 5. Verifier-node delta

[`verifier-node/src/index.ts#verifyPresentation`] already accepts a
custom `acceptedVcts` list. Identity sign-in:

- Adds the `verified-identity/v1` VCT to the default `DEFAULT_ACCEPTED_VCTS`
  *only* when the host explicitly opted in via `request.identity`.
- Adds `subject` (= `payload.sub`) to the success result. Today the
  result returns `cnf.jwk.x` as the de-facto subject; identity sign-in
  returns both, with `subject` taking precedence in the host's account
  lookup.
- Validates `identity_handle` is a string of length ≤ 64 if present
  (defensive; the wallet already enforces this, but a malicious
  wallet could forge it before the issuer JWS is signed — no, it
  can't, because the issuer signs it; so this is just a sanity check
  to surface a typed error rather than crash the host UI).

No new verification rules. The five checks from [`SECURITY.md` §7]
still cover everything (issuer sig, vct accepted, aud, nonce,
sd_hash + KB-JWT).

## 6. Trust posture — what changes, what doesn't

Unchanged:

- Notary is the trust anchor. Nothing identity-bound is signed by
  anyone except the Prson notary RSA key.
- The wallet's identity Ed25519 key is the proof-of-possession root.
  Recovery = mnemonic; loss = revoke + reissue at next sign-in.
- Per-origin unlinkability of `cnf.jwk.x` and (now) `sub`. Origins
  cannot collude to identify the same human across each other unless
  the holder explicitly discloses a stable claim (e.g. legal name) —
  in which case the user consented to that correlation.

New:

- A given origin **can** correlate two sign-in attempts as "same
  Prson identity" (same `sub`). That's the whole point. Mitigation:
  if the user wants distinct accounts on the same origin, they sign
  in with distinct Prson identities.
- A disclosed claim like `document_number` is **highly correlatable
  across origins**. The wallet warns when the user is about to
  disclose any claim flagged `cross-origin-correlatable` to a second
  origin (`document_number`, `tax_id`, `personal_administrative_number`).
  The warning is informational; the user can proceed.

## 7. Implementation phases

The smallest viable cut, each phase independently shippable:

| Phase | Server | Browser SDK | Wallet | Verifier-node |
|---|---|---|---|---|
| **P0 — request shape** | none | accept `request` arg, forward in the SDP payload | render the new sheet, no identity picker yet | accept extra VCTs via existing `acceptedVcts` |
| **P1 — `sub` derivation** | none | – | implement HKDF-`sub`, attach to issued VC via `cnfJwkOverride`-equivalent | return `subject` in the result |
| **P2 — identity picker** | (already supports multi-identity wallets) | – | wire the chooser for ≥ 2 human identities | – |
| **P3 — disclosure preview** | – | – | port the per-claim toggle UI from `identity_share_screen.dart` | – |
| **P4 — handle field** | extend `issueIdentityCredential` to accept `identity_handle` and stamp it in the disclosure | surface `identityHandle` in the result | render the editable field | pass through |
| **P5 — cross-origin warning** | – | – | maintain a small SQLite of `(origin, disclosed claim)` and warn on a second origin | – |

P0–P2 give you everything a typical "let me link my Prson identity to
this account" flow needs. P3–P5 round out the privacy posture.

## 8. Open questions

- **Org identities.** A user can represent an org via a member
  signature chain. Should "sign in as Acme Inc" use this same flow,
  or a separate `verified-org/v1` VCT? Probably separate, but the
  `request` arg above is forward-compatible (`identity: "org"`).
- **`sub` rotation.** What does the user experience if they re-mint
  the identity (mnemonic-recover after device loss)? `sub` is
  deterministic from `identityRootSecret`, so it's preserved. Good.
  What if they want a fresh `sub` on this origin (account reset)?
  TBD — probably a wallet-side "rotate origin keys" action that
  bumps a per-origin epoch into the HKDF info string.
- **Predicate-only sign-in.** A host that wants "this is a verified
  adult, no PII" could ask for `age_gte_18` disclosed and nothing
  else, using the predicate flow we just landed
  ([`functions/utils/predicateFormatters.js`]). That's a separate
  request mode worth specifying — it composes orthogonally with
  identity sign-in. Out of scope here; ship after P5.

---

## Acceptance tiers — anonymous vs level-0 vs verified

A host configures what it accepts via two orthogonal knobs:

| Mode | Option | What the RP gets | What it does NOT get |
|---|---|---|---|
| Anonymous | `allowAnonymous: true` | Self-signed per-domain key (`cnf.jwk.x` as stable id); no identity at all | No claims, no notary signature, no `sub` continuity if the user resets |
| Pseudonymous (level 0) | `required.minVerificationLevel: 0` | Notary-minted SD-JWT-VC for an **unverified** identity — honest claims `verified_human: false`, `verification_level: 0`, `strength: "none"`; stable per-domain `sub`; full KB-JWT binding | Any assurance a real/unique human is behind it (TTL capped at 30 d) |
| Verified | `required.minVerificationLevel: 1..6` (default 1) | The existing verified-human / verified-identity flow | — |

Enforcement is layered: the wallet's drawer only offers identities
meeting the floor (defaulting to 1 when the host didn't specify, so
unverified identities are never offered by accident); the issuance
endpoint refuses level-0 minting unless the request carries the
host's explicit opt-in; and the browser SDK re-checks
`claims.verification_level` against the floor AFTER cryptographic
verification, so host policy never depends on wallet behaviour.

Combine `required.minVerificationLevel: 0` with `allowAnonymous: true`
to offer users the full choice: named-but-unverified identity OR
fully anonymous key.

## Appendix A. Backwards compatibility

A host on the current SDK (no `request` arg) keeps the existing
behaviour exactly: verified-human VCT, no `sub` in the result.

A host that opts into identity sign-in but talks to an older wallet
that doesn't understand the `request` field gets the verified-human
VCT back, no `sub`, no disclosed claims beyond `verified_human`. The
SDK detects this (looks at `payload.vct`) and surfaces a typed
warning so the host can either accept the downgraded result or
re-prompt with a clearer "please update your Prson wallet" message.

## Appendix B. References

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) §2 — relay + transport.
- [`SECURITY.md`](./SECURITY.md) §7 — the five verification rules.
- [`TRUST-CHAIN.md`](./TRUST-CHAIN.md) — issuer / holder / verifier
  responsibilities.
- [`packages/verifier-node/src/index.ts`](./packages/verifier-node/src/index.ts) —
  `verifyPresentation`, `verifySignedFragment`, `verifyFragmentCredential`.
- [`mobile-app/prson_app/lib/core/services/identity_credential_service.dart`](../mobile-app/prson_app/lib/core/services/identity_credential_service.dart) —
  `exportHumanPresentation`, `exportIdentityPresentation`.
- [`mobile-app/prson_app/docs/trust_architecture.md`](../mobile-app/prson_app/docs/trust_architecture.md) §6.3 —
  per-domain holder-key derivation (which `sub` derivation mirrors).
