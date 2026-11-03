// node --test: the Token Status List check (status.ts) against lists signed
// as the Prson API signs them (cloudflare-workers/api/src/services/credentialStatus.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCredentialStatus, clearStatusCache } from "./status.js";

const URI = "https://api.prson.net/v1/status-lists/1";
const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const enc = new TextEncoder();

async function issuer() {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { pair, jwk };
}

async function token(key: CryptoKey, revoked: number[], over: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const bits = new Uint8Array(1024);
  for (const i of revoked) bits[i >> 3]! |= 1 << (i & 7);
  const lst = new Uint8Array(await new Response(new Blob([bits]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const iat = Math.floor(Date.now() / 1000);
  const h = b64u(enc.encode(JSON.stringify({ alg: "RS256", kid: "k1", typ: "statuslist+jwt", ...header })));
  const p = b64u(enc.encode(JSON.stringify({ sub: URI, iat, exp: iat + 3600, ttl: 300, status_list: { bits: 1, lst: b64u(lst) }, ...over })));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${h}.${p}`)));
  return `${h}.${p}.${b64u(sig)}`;
}

const served = (body: string, count = { n: 0 }) => async () => {
  count.n++;
  return { ok: true, status: 200, text: async () => body };
};
const down = async () => {
  throw new Error("network down");
};

test("a valid entry passes, a revoked one fails, and the list is cached", async () => {
  clearStatusCache();
  const { pair, jwk } = await issuer();
  const count = { n: 0 };
  const opts = { resolveKey: async () => jwk, fetch: served(await token(pair.privateKey, [42]), count) };
  assert.deepEqual(await checkCredentialStatus({ status: { status_list: { idx: 7, uri: URI } } }, opts), { ok: true, checked: true });
  assert.deepEqual(await checkCredentialStatus({ status: { status_list: { idx: 42, uri: URI } } }, opts), { ok: false, reason: "vc_revoked", detail: "invalid" });
  assert.equal(count.n, 1);
});

test("a list not signed by the issuer, or for another uri, is not trusted", async () => {
  clearStatusCache();
  const { pair } = await issuer();
  const other = await issuer();
  const strong = { verified_human: true, verification_level: 5, status: { status_list: { idx: 1, uri: URI } } };
  const forged = await checkCredentialStatus(strong, { resolveKey: async () => other.jwk, fetch: served(await token(pair.privateKey, [])) });
  assert.equal(forged.ok, false);
  clearStatusCache();
  const moved = await checkCredentialStatus(strong, { resolveKey: async () => (await issuer()).jwk, fetch: served(await token(pair.privateKey, [], { sub: "https://evil.example/1" })) });
  assert.equal(moved.ok, false);
});

test("when the list is unreachable: closed for level 5, open below, or as configured", async () => {
  clearStatusCache();
  const resolveKey = async () => null;
  const strong = { verified_human: true, verification_level: 5, status: { status_list: { idx: 1, uri: URI } } };
  const weak = { verified_human: false, verification_level: 2, status: { status_list: { idx: 1, uri: URI } } };
  assert.deepEqual(await checkCredentialStatus(strong, { resolveKey, fetch: down }), { ok: false, reason: "status_unavailable", detail: "network down" });
  assert.deepEqual(await checkCredentialStatus(weak, { resolveKey, fetch: down }), { ok: true, checked: false, unavailable: "network down" });
  assert.equal((await checkCredentialStatus(strong, { resolveKey, fetch: down, onUnavailable: "fail-open" })).ok, true);
  assert.equal((await checkCredentialStatus(weak, { resolveKey, fetch: down, onUnavailable: "fail-closed" })).ok, false);
});

test("credentials without a status entry aren't checked; a malformed one is refused", async () => {
  assert.deepEqual(await checkCredentialStatus({ verification_level: 5 }, { resolveKey: async () => null, fetch: down }), { ok: true, checked: false });
  const bad = await checkCredentialStatus({ status: { status_list: { idx: -1, uri: "http://insecure.example/1" } } }, { resolveKey: async () => null, fetch: down });
  assert.equal(bad.ok, false);
});
