// verifyUniqueHumanId: the envelope is bound to one sign-in (its nonce and
// the wallet's sign-in key), so a copied envelope can't be replayed by
// someone else. Envelopes are signed here the way the Prson API signs them
// (RSA-SHA256 over sorted-keys JSON).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { verifyUniqueHumanId } from "../dist/index.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = `k-${randomBytes(4).toString("hex")}`;
const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256" };
const fetch = async () => ({ ok: true, status: 200, json: async () => ({ keys: [jwk] }), text: async () => "" });
const keyOpts = { jwksUri: `https://keys.prson.test/jwks.json?${kid}`, fetch };

function canonical(o: unknown): string {
  if (o === null || o === undefined) return "null";
  if (typeof o !== "object") return typeof o === "string" ? JSON.stringify(o) : String(o);
  if (Array.isArray(o)) return `[${o.map(canonical).join(",")}]`;
  const r = o as Record<string, unknown>;
  return `{${Object.keys(r).sort().map((k) => `${JSON.stringify(k)}:${canonical(r[k])}`).join(",")}}`;
}

const NONCE = "n-0123456789abcdef";
const CNF_X = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function credential(over: Record<string, unknown> = {}, drop: string[] = []) {
  const envelope: Record<string, unknown> = {
    scope: "prson-unique-human/1",
    audience: "shop.example.com",
    uniqueIdHash: "u-1",
    trustTier: "nfc",
    verificationLevel: 5,
    documentType: "passport",
    issuingCountry: "PT",
    signedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    nonce: NONCE,
    cnf: { jwk: { kty: "OKP", crv: "Ed25519", x: CNF_X } },
    ...over,
  };
  for (const k of drop) delete envelope[k];
  const s = createSign("RSA-SHA256");
  s.update(canonical(envelope));
  return { envelope, signature: s.sign(privateKey).toString("base64"), kid } as never;
}

const bound = { ...keyOpts, expectedAudience: "shop.example.com", expectedNonce: NONCE, expectedCnfX: CNF_X };

test("a bound envelope verifies with the sign-in's nonce and key", async () => {
  const r = await verifyUniqueHumanId(credential(), bound);
  assert.equal(r.ok, true, JSON.stringify(r));
});

test("another sign-in's nonce or key is refused", async () => {
  const n = await verifyUniqueHumanId(credential(), { ...bound, expectedNonce: "other" });
  assert.deepEqual([n.ok, !n.ok && n.reason], [false, "nonce_mismatch"]);
  const k = await verifyUniqueHumanId(credential(), { ...bound, expectedCnfX: "B".repeat(43) });
  assert.deepEqual([k.ok, !k.ok && k.reason], [false, "cnf_mismatch"]);
});

test("without expectedNonce and expectedCnfX the check refuses to run", async () => {
  const r = await verifyUniqueHumanId(credential(), { ...keyOpts, expectedAudience: "shop.example.com" });
  assert.deepEqual([r.ok, !r.ok && r.reason], [false, "binding_required"]);
});

test("an envelope from an old wallet (no nonce or cnf) is refused unless allowUnbound", async () => {
  const old = credential({}, ["nonce", "cnf"]);
  const r = await verifyUniqueHumanId(old, bound);
  assert.deepEqual([r.ok, !r.ok && r.reason], [false, "unbound"]);
  const ok = await verifyUniqueHumanId(old, { ...bound, allowUnbound: true });
  assert.equal(ok.ok, true, JSON.stringify(ok));
});

test("allowUnbound still checks a nonce and key the envelope carries", async () => {
  const r = await verifyUniqueHumanId(credential(), { ...bound, allowUnbound: true, expectedNonce: "other" });
  assert.deepEqual([r.ok, !r.ok && r.reason], [false, "nonce_mismatch"]);
});

test("a nonce or key changed after signing fails the signature", async () => {
  const c = credential() as unknown as { envelope: Record<string, unknown> };
  c.envelope.nonce = "forged";
  const r = await verifyUniqueHumanId(c as never, { ...bound, expectedNonce: "forged" });
  assert.deepEqual([r.ok, !r.ok && r.reason], [false, "issuer_sig_invalid"]);
});
