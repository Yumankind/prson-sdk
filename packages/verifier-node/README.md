# @prson/login-verifier

> Pure-function Node.js verifier for SD-JWT-VC presentations issued
> by the Prson notary. **Drop-in**: no Prson API key, no live
> network call beyond fetching the publicly-served notary JWKS
> (cached aggressively). Verifies via standard IETF SD-JWT + SD-JWT-VC
> primitives, so this code reads like spec.
>
> See [`../../README.md`](../../README.md) for the system overview,
> [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) for the wire
> format, [`../../SECURITY.md` §7](../../SECURITY.md#7-the-five-rules-a-verifier-must-enforce)
> for the five rules every verifier must enforce.

## Install

```bash
npm install @prson/login-verifier
```

Node 20 or later. This package is server-side only and has no browser
bundle.

```bash
npm install @prson/login-verifier
```

## API

```ts
import { verifyPresentation, VerifyOptions, VerifyResult } from "@prson/login-verifier";

const result: VerifyResult = await verifyPresentation(presentation, {
  expectedAudience: "https://example.com",
  expectedNonce: "the-nonce-you-generated",

  // Optional knobs:
  maxKbJwtAgeSeconds: 60,            // default 60
  trustedIssuer: "did:web:app.prson.net", // default
  jwksUri: "https://app.prson.net/.well-known/jwt-vc-issuer", // default
  fetch: globalThis.fetch,           // default
  jwksCacheTtlMs: 60 * 60 * 1000,    // default 1h
  acceptedVcts: [                    // default: these two
    "https://app.prson.net/credentials/verified-human/v1",
    "https://app.prson.net/credentials/verified-identity/v1",
  ],
  status: {                          // revocation (Token Status List)
    onUnavailable: "fail-closed",    // default: closed at level 5+, open below
    cacheSeconds: 60,                // default 60
  },
});

if (!result.ok) {
  // result.reason is a VerifyFailureReason (see the table below);
  // result.detail, when present, is a human-readable hint for your logs.
  return res.status(401).send(result.reason);
}

const userId = result.prsonId;      // the person's Prson ID on this site
const claims = result.claims;       // disclosed claim values
```

What `verifyPresentation` checks, in order: the issuer JWS header `typ`
is `dc+sd-jwt` (SD-JWT VC, current draft) or the older `vc+sd-jwt`;
`iss` is the trusted issuer; `vct` is accepted; `exp` is present and in
the future (`nbf`, if set, is not more than 30 s ahead); the RS256
signature against the issuer's published key (by `kid`); the
credential's Token Status List entry (not revoked); every disclosure is
bound by `_sd`; and the key-binding JWT (`typ: kb+jwt`, EdDSA, signed by
`cnf.jwk`) carries your audience and nonce, a fresh `iat`, and the
`sd_hash` of the presentation.

### Failure reasons (`VerifyFailureReason`)

| `reason` | Meaning |
|---|---|
| `malformed` | Not a parseable SD-JWT presentation (shape, JSON, disclosure, missing `exp`). |
| `typ_not_accepted` | The issuer JWS `typ` is not `dc+sd-jwt` or `vc+sd-jwt`. |
| `issuer_key_resolve_failed` | `iss` is not the trusted issuer, there is no `kid`, or the key couldn't be fetched. |
| `issuer_sig_invalid` | The issuer signature does not verify. |
| `vc_expired` | The credential's `exp` has passed. |
| `vc_not_yet_valid` | The credential's `nbf` is in the future. |
| `vct_not_accepted` | `vct` is not in `acceptedVcts`. |
| `disclosure_unmatched` | A disclosure's digest is not in the credential's `_sd`. |
| `kb_missing` | No key-binding JWT, or no `cnf.jwk` (Ed25519) to check it against. |
| `kb_sig_invalid` | The key-binding JWT is malformed, wrongly typed or its signature fails. |
| `aud_mismatch` | The key-binding JWT's `aud` is not `expectedAudience`. |
| `nonce_mismatch` | The key-binding JWT's `nonce` is not `expectedNonce`. |
| `sd_hash_mismatch` | The key-binding JWT doesn't cover this exact presentation. |
| `kb_iat_stale` | The key-binding JWT is older than `maxKbJwtAgeSeconds` (or from the future). |
| `vc_revoked` | The issuer's status list marks the credential invalid or suspended. |
| `status_unavailable` | The status list couldn't be fetched or verified and the policy is `fail-closed` (or the status reference is malformed). |

## Predicate facts and unique-human ids

Facts ("age ≥ 18", "document not expired") are standalone signed
claims, not sign-in proofs: no key binding or nonce; their replay
protection is a short expiry plus, for audience-scoped facts, the
domain they are bound to. All three functions below take
`FragmentVerifyOptions`: `expectedAudience` (your host; required for
audience-scoped facts and always for unique-human ids), `trustedIssuer`,
`jwksUri`, `fetch`, `jwksCacheTtlMs`, `acceptedPredicateVcts` (default
`["https://app.prson.net/credentials/predicate/v1"]`) and `now` (tests).
They resolve to `FragmentVerifyResult` (or `UniqueHumanIdVerifyResult`):
`{ ok: true, fragmentId, value, propertyHash, propertyType, identityId,
signedAt, expiresAt, kid, … }` or `{ ok: false, reason, detail? }`
with `reason` one of `malformed`, `issuer_key_resolve_failed`,
`issuer_sig_invalid`, `expired`, `vct_not_accepted`,
`unsupported_format`, `audience_mismatch`.

```ts
import {
  verifyFragmentCredential,
  verifySignedFragment,
  verifyUniqueHumanId,
} from "@prson/login-verifier";

// A JWT-shaped fact (string). The JWS `typ` picks the format:
//   "vc+jwt"    → a W3C VC Data Model 2.0 credential (@context
//                 https://www.w3.org/ns/credentials/v2, type
//                 ["VerifiableCredential", "PrsonPredicateCredential"]);
//                 the fact is in credentialSubject.
//   "dc+sd-jwt" → an SD-JWT VC whose vct is accepted; the fact is the
//                 disclosure appended after "~".
// Anything else → reason "unsupported_format". Both need iss, a kid,
// an exp in the future and a valid RS256 signature.
const fact = await verifyFragmentCredential(credential, { expectedAudience: "shop.example.com" });
// fact.format: "vc+jwt" | "vc+sd-jwt"

// Prson's native fact object ({ fragmentId, value, propertyHash,
// propertyType, identityId, audience?, signedAt, expiresAt, signature, kid }):
// RSA-SHA256 over the colon-joined fields (plus ":aud:<host>" when scoped).
const native = await verifySignedFragment(fragment, { expectedAudience: "shop.example.com" });
// native.format: "native"

// "One unique, document-verified human at your domain":
// { envelope: { scope: "prson-unique-human/1", audience, uniqueIdHash, … }, signature, kid }.
// Checks scope, audience (must equal expectedAudience), expiry and the
// signature over the canonical (sorted-keys) envelope.
const unique = await verifyUniqueHumanId(credential, { expectedAudience: "shop.example.com" });
if (unique.ok) useAsAccountKey(unique.uniqueIdHash); // pairwise: stable here only
```

`resolveIssuerKey(kid, opts?)` fetches (and caches) an issuer key, e.g.
to pre-warm the cache.

## Revocation on its own: `checkCredentialStatus`

`verifyPresentation` already checks revocation. To check a credential
payload you decoded yourself:

```ts
import { checkCredentialStatus, clearStatusCache } from "@prson/login-verifier";

const r = await checkCredentialStatus(payload /* the decoded JWT claims */, {
  resolveKey: async (kid) => issuerJwkFor(kid), // the issuer's JWK, or null
  onUnavailable: "fail-closed", // default: closed at level 5+ / verified_human, open below
  cacheSeconds: 60,             // default 60, never longer than the list's ttl
  // fetch, now: overrides for tests
});
// { ok: true, checked: true }                       — listed as valid
// { ok: true, checked: false, unavailable?: string } — no status claim, or fail-open
// { ok: false, reason: "vc_revoked" | "status_unavailable", detail? }
```

It reads `status.status_list.{idx, uri}`, fetches the Token Status List
token (`typ: statuslist+jwt`, signed by the issuer key) and reads the
entry: 0 is valid, 1 invalid, 2 suspended. `clearStatusCache()` forgets
cached lists.

## Express middleware example

```ts
import express from "express";
import { verifyPresentation } from "@prson/login-verifier";
import crypto from "node:crypto";

const app = express();
app.use(express.json());

app.get("/api/nonce", (req, res) => {
  // Mint a single-use nonce and stash it in the session for the
  // /api/login round-trip. The SDK passes this same nonce to the
  // wallet via the QR / deep-link.
  const nonce = crypto.randomBytes(32).toString("base64url");
  req.session.prsonNonce = nonce;
  res.json({ nonce });
});

app.post("/api/login", async (req, res) => {
  const result = await verifyPresentation(req.body.presentation, {
    expectedAudience: `https://${req.hostname}`,
    expectedNonce: req.session.prsonNonce,
  });
  if (!result.ok) return res.status(401).json({ error: result.reason });

  // Single-use nonce — discard so a replay can't reuse it.
  delete req.session.prsonNonce;

  req.session.userId = result.prsonId;
  req.session.expiresAt = result.credential.expiresAt;
  res.json({ ok: true, claims: result.claims });
});
```

## Proof verdicts (`prson-truth-verdict/2`)

A verification answer (`GET /v1/verifications/:id`, its webhooks) carries
Prson's signed verdict and the values it covers:

```ts
import { verifyVerdict } from "@prson/login-verifier";

// response.verdict_signature  = { envelope, signature, kid }
// response.verdict_disclosures = [[salt, kind, id, value], ...]
const keys = (await (await fetch("https://api.prson.net/v1/company/public-key")).json())
  .verificationKeys.map((k: { kid: string; publicKey: string }) => ({ kid: k.kid, publicKey: k.publicKey }));
const { envelope, signature, kid } = response.verdict_signature;
const result = verifyVerdict(envelope, signature, response.verdict_disclosures, { keys, kid });
// result.ok: the signature checks and every value is one Prson signed.
// result.disclosures: [{ kind, id, value, verified, reason? }] per value.
```

The envelope holds one `{kind, id, digest}` per disclosed item (`kind`:
`fact`, `property` or `document_field`), with
`digest = base64url(SHA-256(canonicalJson([salt, kind, id, value])))`; the
16-byte random salt means the envelope alone reveals no value. Keep the
envelope, signature and disclosures together and anyone can re-check them
offline later. `opts` takes `publicKey` (SPKI PEM, JWK or `KeyObject`) or
`keys: [{kid, publicKey}]` plus the seal's `kid`. A `prson-truth-verdict/1`
envelope (made before verdicts covered values) can still have a valid
signature, but no value verifies against it (`reason: "not-covered"`).
`verdictDisclosureDigest(d)` and `canonicalJson(v)` are exported too.

## Website notifications

`readNotifyHandle(body)` reads the handle the browser SDK returned
(`signIn({ notifications: true })`); keep it on the account you just verified.
`sendNotification({ apiKey, handle, title, body, url? })` posts to
`/v1/notify` (an API key with `notify:write`); `revoked: true` (410) means
the person turned your site off. See `documentation/SITE_NOTIFICATIONS.md`.

## Build status

Implemented on [`jose`](https://github.com/panva/jose) and `node:crypto`;
tests: `npm test` (unit tests plus `test/*.test.ts`, which check real
credential shapes). See
[`../../CHANGELOG.md`](../../CHANGELOG.md).
