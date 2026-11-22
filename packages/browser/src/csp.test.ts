import { test } from "node:test";
import assert from "node:assert/strict";
import { PrsonCspError, connectSourcesFor, watchCsp } from "./csp.js";

test("connectSourcesFor: production and a local Worker", () => {
  assert.deepEqual(connectSourcesFor("https://signaling.prson.net"), [
    "https://signaling.prson.net",
    "wss://signaling.prson.net",
    "https://app.prson.net",
    "https://api.prson.net",
  ]);
  assert.deepEqual(connectSourcesFor("http://localhost:8787").slice(0, 2), ["http://localhost:8787", "ws://localhost:8787"]);
});

test("watchCsp outside a browser passes errors through", async () => {
  const w = watchCsp("https://signaling.prson.net");
  const e = new Error("x");
  assert.equal(await w.explain(e), e);
  w.stop();
});

test("watchCsp turns a trusted block of a Prson host into PrsonCspError", async () => {
  let listener: ((e: unknown) => void) | null = null;
  const fakeDoc = {
    addEventListener: (_t: string, fn: (e: unknown) => void) => (listener = fn),
    removeEventListener: () => (listener = null),
  };
  const fire = (e: Record<string, unknown>) => listener?.(e);
  const g = globalThis as { document?: unknown };
  const before = g.document;
  g.document = fakeDoc;
  try {
    const w = watchCsp("https://signaling.prson.net");
    // Someone else's host, and a page-made (untrusted) event: both ignored.
    fire({ isTrusted: true, blockedURI: "https://cdn.example.com/x.js", effectiveDirective: "script-src" });
    fire({ isTrusted: false, blockedURI: "wss://signaling.prson.net/x", effectiveDirective: "connect-src" });
    const plain = new Error("Failed to fetch");
    assert.equal(await w.explain(plain), plain);

    fire({ isTrusted: true, blockedURI: "wss://signaling.prson.net/login/v1/req-secret", effectiveDirective: "connect-src" });
    const out = await w.explain(new Error("signaling: WS error"));
    assert.ok(out instanceof PrsonCspError);
    assert.equal(out.directive, "connect-src");
    assert.equal(out.blockedUri, "wss://signaling.prson.net");
    assert.doesNotMatch(out.message, /req-secret/);
    assert.match(out.message, /https:\/\/api\.prson\.net/);
    w.stop();
    assert.equal(listener, null);
  } finally {
    g.document = before;
  }
});
