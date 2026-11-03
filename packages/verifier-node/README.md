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
});

if (!result.ok) {
  // result.reason is one of:
  // "issuer_sig_invalid" | "kb_sig_invalid" | "aud_mismatch" |
  // "nonce_mismatch" | "sd_hash_mismatch" | "kb_iat_stale" |
  // "vc_expired" | "vc_not_yet_valid" | "vct_not_accepted" |
  // "disclosure_unmatched" | "issuer_key_resolve_failed" | "malformed";
  return res.status(401).send(result.reason);
}

const subjectId = result.cnf.jwk.x; // stable per-user id on this site
const claims = result.claims;       // disclosed claim values
```

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

  req.session.userId = result.cnf.jwk.x;
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

## Build status

Phase 1 ships the spec, the type surface in `src/index.ts`, and this
README. Phase 2 fills in the runtime against the
[`jose`](https://github.com/panva/jose) library.
