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
3. **`aud` matches** `expectedAudience` in BOTH the VC body and
   the KB-JWT. A presentation issued for `bank.com` can't be
   replayed against `evil.com`.
4. **`nonce` matches** the value the verifier put in the
   `/session/draft` blob. Prevents replay across sign-in attempts.
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
npm start
# → listening on http://localhost:8080
```

`POST /verify` with a JSON body:

```bash
curl -sS http://localhost:8080/verify \
  -H 'content-type: application/json' \
  -d '{
    "presentation": "<the SD-JWT-VC compact string the browser passed up>",
    "audience": "https://your-site.example",
    "nonce": "<the same nonce you minted at /session/draft time>"
  }'
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

Response on failure:

```json
{ "ok": false, "reason": "nonce_mismatch", "detail": "..." }
```

The `reason` is one of the typed codes from
[`VerifyFailureReason`](../../packages/verifier-node/src/index.ts) —
each one points at a single one of the five checks above so you can
log + alert with confidence about what went wrong.

## Where the nonce + audience come from

For the canonical sign-in flow:

- `expectedAudience` is your origin, e.g. `https://your-site.example`.
  The browser SDK already sent `aud: "https://<domain>"` to the
  wallet; pass the same value here.
- `expectedNonce` is the random 32-byte base64url the browser
  generated and POSTed to `/session/draft`. You stored it in the
  draft record alongside the verifier request blob; retrieve it
  by `reqId` when the browser later submits the presentation.

If the host is using anonymous-wallet credentials
(`signIn({ allowAnonymous: true })`), pass `acceptedVcts` that
includes the anonymous VCT
(`https://app.prson.net/credentials/anonymous-wallet/v1`) so the
verifier accepts the self-signed form.
