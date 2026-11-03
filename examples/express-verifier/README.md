# Express verifier — end-to-end SD-JWT-VC validation

A minimal Node.js / Express server that **verifies** a Prson login
presentation. It mirrors what the browser SDK already does
client-side (`verifyPresentation` in
[`packages/browser/src/verify.ts`](../../packages/browser/src/verify.ts)),
so a backend that wants to gate its own session cookie on a verified
identity can drop this in.

Why verify server-side too? The browser already checked the
presentation cryptographically before resolving `signIn()`, but a
backend integrator usually wants to:

1. **Anchor** the issued session cookie to the verified
   `cnf.jwk.x`, so a stolen cookie can't be replayed against a
   different identity.
2. **Audit** the disclosed claims independently — a malicious
   frontend cannot decide what counts as "verified" on its own.
3. **Trust on its own root** — the server uses the same notary DID
   document (`did:web:app.prson.net/.well-known/jwt-vc-issuer`) as
   the browser, so they reach the same conclusion from the same
   evidence.

This example is intentionally tiny: one route, one verifier call,
no database. Use it as a recipe rather than a framework.

## The five checks `verifyPresentation` runs

1. **Issuer JWS signature** verifies against the notary's public
   key, fetched from the trusted JWKS URI (default
   `https://app.prson.net/.well-known/jwt-vc-issuer`). Anything
   signed by anyone else fails fast.
2. **`vct` is in the accepted list** —
   `verified-human/v1`, `verified-identity/v1` are the defaults.
   Anything outside is rejected.
3. **`aud` matches** `expectedAudience` in the KB-JWT. A presentation
   made for `bank.com` can't be replayed against `evil.com`.
4. **`nonce` matches** the one-time value your server issued for this
   sign-in. Prevents replay across sign-in attempts.
5. **KB-JWT signature** verifies against `cnf.jwk` AND the
   embedded `sd_hash` equals SHA-256 of the actual disclosed
   chain. This is the proof-of-possession — the holder of the
   private key bound to `cnf.jwk.x` signed exactly the disclosures
   we received, for exactly this `aud`/`nonce`.

If all five pass, you've proven: *the user holding the private key
matching `cnf.jwk.x` presented these claims, which the Prson notary
previously attested are facts about that user, to this server, for
this sign-in attempt.*

See [`TRUST-CHAIN.md`](../../TRUST-CHAIN.md) §2 for the long-form
explanation.

## Run it

```bash
cd login-sdk/examples/express-verifier
npm install
PRSON_HOST=your-site.example npm start
# → listening on http://localhost:8080
```

The sign-in takes three steps:

1. **Your backend issues a nonce.** The browser calls `POST /nonce` and gets `{ "nonce": "…" }`.
   The server keeps it for 5 minutes.
2. **The browser signs in with it.** `const r = await PrsonLogin.signIn({ nonce })`, then it
   posts `r.sdJwtVc` and the nonce to your backend.
3. **Your backend verifies.**

```bash
curl -sS http://localhost:8080/verify \
  -H 'content-type: application/json' \
  -d '{ "presentation": "<r.sdJwtVc>", "nonce": "<the nonce from /nonce>" }'
```

Response on success:

```json
{
  "ok": true,
  "subject": "<the cnf.jwk.x — your stable per-user identifier>",
  "claims": { "verified_human": 5, "...": "..." },
  "credential": {
    "vct": "https://app.prson.net/credentials/verified-human/v1",
    "iss": "did:web:app.prson.net",
    "kid": "2026-05",
    "expiresAt": 1748509100
  }
}
```

Response on failure (the `detail` goes to the server log, not the client):

```json
{ "ok": false, "reason": "nonce_mismatch" }
```

`nonce_unknown_or_used` means the nonce wasn't issued by this server, expired, or was already
used. The other `reason` values are the typed codes from
[`VerifyFailureReason`](../../packages/verifier-node/src/index.ts), one per check above.

## Where the nonce and audience come from

- **`expectedAudience`** is always `https://<your host>`, from your own configuration
  (`PRSON_HOST`). The browser SDK binds the presentation to the page's origin. Never take the
  audience from the request: a presentation made for another site would then pass.
- **`expectedNonce`** is the value your server issued, looked up and deleted on first use. Never
  take it from the request alone, or a captured presentation can be replayed. If the page calls
  `signIn()` without `nonce`, the SDK makes one in the browser. That protects only the
  in-browser check, not your backend.

If the host is using anonymous-wallet credentials
(`signIn({ allowAnonymous: true })`), pass `acceptedVcts` that
includes the anonymous VCT
(`https://app.prson.net/credentials/anonymous-wallet/v1`) so the
verifier accepts the self-signed form.

## `POST /verify-fragment` — predicate verification

A predicate (signed property "fragment") is a single bound claim about
the user — "age >= 18", "balance >= 5000 EUR", "doc not expired". The
mobile app mints one on-demand via the Cloud Function
`signPropertyFragment` and hands it back to the host page through the
same WebRTC channel as a login presentation. Three wire formats are
supported by the same Cloud Function — pick whichever your stack
already speaks:

- **`native`** — Prson's own shape. Flat JSON, single RSA-SHA256
  signature. Smallest on the wire.
- **`vc+jwt`** — W3C VC Data Model 2.0 JWS. Standard JOSE, verifies
  with any library that knows RS256 + a JWKS.
- **`vc+sd-jwt`** — IETF SD-JWT-VC. Same JWS, but the predicate value
  ships as a selectively-disclosed disclosure suffix (`~<b64u>~`).

`POST /verify-fragment` accepts all three:

```bash
# native (object)
curl -sS http://localhost:8080/verify-fragment \
  -H 'content-type: application/json' \
  -d '{"fragment":{"fragmentId":"age_gte_18","value":true,"propertyHash":"...","propertyType":"birthdate","identityId":"...","signedAt":"...","expiresAt":"...","signature":"<base64>","kid":"2026-05"}}'

# vc+jwt or vc+sd-jwt (compact string)
curl -sS http://localhost:8080/verify-fragment \
  -H 'content-type: application/json' \
  -d '{"fragment":"eyJ0eXAiOiJ2Yytqd3QiLCJhbGciOiJSUzI1NiI..."}'
```

Success response:

```json
{
  "ok": true,
  "format": "vc+sd-jwt",
  "fragmentId": "age_gte_18",
  "value": true,
  "propertyHash": "<sha256 hex>",
  "propertyType": "birthdate",
  "identityId": "<prson identity id>",
  "signedAt": "2026-05-29T10:00:00.000Z",
  "expiresAt": "2026-05-29T11:00:00.000Z",
  "kid": "2026-05"
}
```

The verifier checks: the RSA signature against the notary's published
JWK, the expiry (required), the `vct` (for JWT shapes) and the audience.
A fact the wallet made for a site is bound to that site's host; this
server passes its own `PRSON_HOST` as `expectedAudience`, so a fact
made for another site fails with `audience_mismatch`. Facts carry no
nonce: within their lifetime one can be presented again to the same
site, so tie it to the signed-in user (`identityId`, `propertyHash`).
Label a fact from its `fragmentId`: the native format's `description`
isn't covered by the signature, so it isn't returned.

