import { test } from "node:test";
import assert from "node:assert/strict";
import { PrsonLoginError, asLoginError, closedCode } from "./errors.js";
import { PrsonCspError, connectSourcesFor } from "./csp.js";

test("a relay close names expiry or a network failure", () => {
  assert.equal(closedCode("draft_expired"), "expired");
  assert.equal(closedCode("code-1006"), "network");
  assert.equal(closedCode("rate-limited"), "network");
});

test("every error becomes a PrsonLoginError with a code", () => {
  const coded = new PrsonLoginError("level_too_low", "too low");
  assert.equal(asLoginError(coded), coded);
  const fetchFail = asLoginError(new TypeError("Failed to fetch"));
  assert.equal(fetchFail.code, "network");
  const other = new Error("boom");
  const wrapped = asLoginError(other);
  assert.equal(wrapped.code, "unknown");
  assert.equal(wrapped.cause, other);
  assert.equal(asLoginError("plain string").code, "unknown");
});

test("a CSP block is a PrsonLoginError with code csp_blocked", () => {
  const e = new PrsonCspError("connect-src", "https://api.prson.net", ["https://api.prson.net"]);
  assert.ok(e instanceof PrsonLoginError);
  assert.equal(e.code, "csp_blocked");
});

test("dev sign-ins allow the dev API's origin instead of production's", () => {
  const dev = connectSourcesFor("https://signaling-dev.prson.net", "https://prson-api-dev.powerhouse.workers.dev/.well-known/jwt-vc-issuer");
  assert.deepEqual(dev, ["https://signaling-dev.prson.net", "wss://signaling-dev.prson.net", "https://prson-api-dev.powerhouse.workers.dev"]);
});
