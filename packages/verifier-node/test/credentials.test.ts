// verifyFragmentCredential / verifyPresentation against credentials shaped
// as the Prson API issues them (services/propertyFragments.ts,
// services/credentials.ts), signed here with jose: the media type (`typ`)
// and the credential shape are checked, not just the signature.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
// The compiled package (npm test runs tsc first): src/index.ts imports ./status.js.
import { verifyFragmentCredential, verifyPresentation } from "../dist/index.js";

const ISS = "did:web:app.prson.net";
const VCT = "https://app.prson.net/credentials/predicate/v1";
const JWKS_URI = "https://keys.prson.test/jwks.json";

async function issuer() {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: `k-${randomBytes(4).toString("hex")}`, alg: "RS256" };
  const fetch = async () => ({ ok: true, status: 200, json: async () => ({ keys: [jwk] }), text: async () => "" });
  return { privateKey, kid: jwk.kid, opts: { jwksUri: `${JWKS_URI}?${jwk.kid}`, fetch, trustedIssuer: ISS } };
}

const now = () => Math.floor(Date.now() / 1000);

async function sdFact(privateKey: CryptoKey, kid: string, typ: string, over: Record<string, unknown> = {}) {
  const disclosure = Buffer.from(JSON.stringify([randomBytes(16).toString("base64url"), "age_gte_18", true])).toString("base64url");
  const digest = createHash("sha256").update(disclosure).digest("base64url");
  const jws = await new SignJWT({ iss: ISS, sub: "pairwise-1", iat: now(), exp: now() + 3600, vct: VCT, _sd_alg: "sha-256", _sd: [digest], ...over })
    .setProtectedHeader({ alg: "RS256", kid, typ })
    .sign(privateKey);
  return `${jws}~${disclosure}~`;
}

async function vcJwtFact(privateKey: CryptoKey, kid: string, over: Record<string, unknown> = {}) {
  const iat = now();
  return new SignJWT({
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential", "PrsonPredicateCredential"],
    issuer: ISS,
    validFrom: new Date(iat * 1000).toISOString(),
    validUntil: new Date((iat + 3600) * 1000).toISOString(),
    credentialSubject: { id: "pairwise-1", fragmentId: "age_gte_18", value: true },
    iss: ISS,
    sub: "pairwise-1",
    iat,
    exp: iat + 3600,
    ...over,
  })
    .setProtectedHeader({ alg: "RS256", kid, typ: "vc+jwt" })
    .sign(privateKey);
}

test("a predicate fact as an SD-JWT VC (typ dc+sd-jwt) verifies; any other typ doesn't", async () => {
  const { privateKey, kid, opts } = await issuer();
  const ok = await verifyFragmentCredential(await sdFact(privateKey, kid, "dc+sd-jwt"), opts);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  for (const typ of ["sd-jwt", "JWT", "kb+jwt"]) {
    const res = await verifyFragmentCredential(await sdFact(privateKey, kid, typ), opts);
    assert.deepEqual([res.ok, !res.ok && res.reason], [false, "unsupported_format"], typ);
  }
});

test("a predicate fact as a VC Data Model 2.0 vc+jwt verifies; without its @context or type it doesn't", async () => {
  const { privateKey, kid, opts } = await issuer();
  const ok = await verifyFragmentCredential(await vcJwtFact(privateKey, kid), opts);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const noContext = await verifyFragmentCredential(await vcJwtFact(privateKey, kid, { "@context": undefined }), opts);
  assert.deepEqual([noContext.ok, !noContext.ok && noContext.reason], [false, "malformed"]);
  const otherType = await verifyFragmentCredential(await vcJwtFact(privateKey, kid, { type: ["VerifiableCredential"] }), opts);
  assert.deepEqual([otherType.ok, !otherType.ok && otherType.reason], [false, "vct_not_accepted"]);
});

test("a presentation must be an SD-JWT VC with an expiry", async () => {
  const { privateKey, kid, opts } = await issuer();
  const base = { ...opts, expectedAudience: "shop.example", expectedNonce: "n", acceptedVcts: [VCT] };
  // A key-binding JWT is appended so the checks reach the issuer JWT (they fail before the KB-JWT is checked).
  const kb = "eyJhbGciOiJFZERTQSJ9.e30.AA";
  const wrongTyp = await verifyPresentation((await sdFact(privateKey, kid, "JWT")) + kb, base);
  assert.deepEqual([wrongTyp.ok, !wrongTyp.ok && wrongTyp.reason], [false, "typ_not_accepted"]);
  const noExp = await verifyPresentation((await sdFact(privateKey, kid, "dc+sd-jwt", { exp: undefined })) + kb, base);
  assert.deepEqual([noExp.ok, !noExp.ok && noExp.reason], [false, "malformed"]);
});
