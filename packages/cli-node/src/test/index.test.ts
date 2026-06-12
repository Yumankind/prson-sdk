import { test } from "node:test";
import assert from "node:assert";

import { createFactsRequest, pollForResponse, userCodeFromNonce } from "../index.js";

test("builds a wallet-parseable /request/v1 link", () => {
  const r = createFactsRequest({
    domain: "Example.com",
    responseUrl: "https://example.com/prson/cli",
    required: { predicates: ["age_gte_18", "email_domain_academic"], uniqueHumanId: true },
  });
  const url = new URL(r.url);
  assert.strictEqual(url.origin, "https://app.prson.net");
  assert.strictEqual(url.pathname, "/request/v1");
  const req = JSON.parse(Buffer.from(url.searchParams.get("req")!, "base64url").toString("utf8"));
  // Exactly what mobile-app's WalletActionLink.tryParseRequest expects.
  assert.strictEqual(req.v, 1);
  assert.strictEqual(req.domain, "example.com"); // lowercased
  assert.strictEqual(req.responseUrl, "https://example.com/prson/cli");
  assert.ok(req.nonce.length >= 16);
  assert.deepStrictEqual(req.required.predicates, ["age_gte_18", "email_domain_academic"]);
  assert.strictEqual(req.required.uniqueHumanId, true);
  assert.match(r.userCode, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  assert.strictEqual(r.userCode, userCodeFromNonce(r.nonce));
});

test("refuses delivery endpoints the wallet would refuse", () => {
  const base = {
    domain: "example.com",
    required: { minVerificationLevel: 4 },
  };
  // http
  assert.throws(() => createFactsRequest({ ...base, responseUrl: "http://example.com/cb" }));
  // host != domain (anti-exfiltration pin)
  assert.throws(() => createFactsRequest({ ...base, responseUrl: "https://evil.com/cb" }));
  // non-443 port
  assert.throws(() => createFactsRequest({ ...base, responseUrl: "https://example.com:8443/cb" }));
  // returnUrl pinned too
  assert.throws(() =>
    createFactsRequest({
      ...base,
      responseUrl: "https://example.com/cb",
      returnUrl: "https://other.com/done",
    })
  );
});

test("refuses empty requests and bad domains", () => {
  assert.throws(() =>
    createFactsRequest({ domain: "example.com", responseUrl: "https://example.com/cb", required: {} })
  );
  assert.throws(() =>
    createFactsRequest({ domain: "localhost", responseUrl: "https://localhost/cb", required: { uniqueHumanId: true } })
  );
  assert.throws(() =>
    createFactsRequest({
      domain: "example.com",
      responseUrl: "https://example.com/cb",
      required: { minVerificationLevel: 9 },
    })
  );
});

test("pollForResponse resolves on first non-null and times out", async () => {
  let calls = 0;
  const out = await pollForResponse(
    async () => (++calls >= 3 ? "session-token" : null),
    { intervalMs: 5, timeoutMs: 1000 }
  );
  assert.strictEqual(out, "session-token");
  assert.strictEqual(calls, 3);

  await assert.rejects(
    pollForResponse(async () => null, { intervalMs: 5, timeoutMs: 30 }),
    /timed out/
  );
});

test("user codes are stable and use the Crockford alphabet", () => {
  const a = userCodeFromNonce("fixed-nonce-value-1234");
  assert.strictEqual(a, userCodeFromNonce("fixed-nonce-value-1234"));
  assert.doesNotMatch(a, /[ILOU]/); // ambiguous letters excluded
});
