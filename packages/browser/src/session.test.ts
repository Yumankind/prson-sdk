/**
 * Lifecycle-event dispatch tests for PrsonLoginSession.
 *
 * Run via Node's built-in test runner with the TypeScript
 * type-stripping flag:
 *
 *     node --test --experimental-strip-types src/session.test.ts
 *
 * No vitest install needed. Covers:
 *
 *   * signed_in fires once via microtask after construction.
 *   * on(type, cb) + onAny(cb) both receive matching events.
 *   * Back-compat onRenewed / onExpiry route through the new
 *     dispatch — same callback receives the same payload.
 *   * Unsubscribe handle removes the listener.
 *   * display-update emits only the changed fields.
 *   * credential-revoked emits the event AND triggers signed_out.
 *   * A throwing listener doesn't break the rest of the dispatch.
 *   * Events after teardown are dropped (no listeners called).
 *
 * Renewal + claim-update paths re-verify their inner presentation;
 * those branches need a real SD-JWT-VC and are exercised end-to-end
 * by the example page rather than here.
 */

import test from "node:test";
import { strict as assert } from "node:assert";

import { PrsonLoginSession, type LoginEvent } from "./session.js";
import type { Transport } from "./transport.js";
import type { EphemeralKeys } from "./crypto.js";

// ─── Fixtures ──────────────────────────────────────────────────────

/** Minimal Transport stub — records onMessage subscribers; close() is a no-op. */
function makeTransport(): Transport {
  return {
    onMessage: () => {},
    send: () => {},
    awaitFirstMessage: async () => "" as never,
    close: () => {},
  } as unknown as Transport;
}

/** Doesn't matter for the dispatch tests — we never decrypt. */
const ephKeys: EphemeralKeys = {
  secretKey: new Uint8Array(32),
  publicKey: new Uint8Array(32),
  publicKeyB64u: "",
};

const verifierContext = {
  expectedAudience: "https://example.com",
  expectedNonceFactory: () => "fixed-nonce",
  acceptedVcts: ["https://app.prson.net/credentials/verified-human/v1"],
  trustedIssuer: "did:web:app.prson.net",
};

const cnf = { jwk: { kty: "OKP" as const, crv: "Ed25519" as const, x: "abc" } };

const expiresFarFuture = Date.now() + 3_600_000;

function makeSession(opts?: {
  initialClaims?: Record<string, unknown>;
  initialSignedInResult?: unknown;
}) {
  return new PrsonLoginSession({
    cnf,
    credential: { expiresAt: expiresFarFuture },
    transport: makeTransport(),
    ephKeys,
    verifierContext,
    initialClaims: opts?.initialClaims,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initialSignedInResult: opts?.initialSignedInResult as any,
  });
}

/** Wait one microtask + one macrotask so `queueMicrotask` callbacks
 *  scheduled during construction have run. */
async function flushMicrotasks() {
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

// ─── Tests ─────────────────────────────────────────────────────────

test("signed_in fires once via microtask after construction", async () => {
  const events: LoginEvent[] = [];
  const session = makeSession({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initialSignedInResult: { fakeMarker: 42 } as any,
  });
  session.on("signed_in", (e) => events.push(e));
  session.onAny((e) => events.push(e));

  // Synchronously, no events yet — they're microtask-deferred.
  assert.equal(events.length, 0);

  await flushMicrotasks();

  // After microtasks drain, signed_in landed on BOTH the typed
  // listener AND the onAny listener (one event, two deliveries).
  assert.equal(events.length, 2);
  assert.equal(events[0]!.type, "signed_in");
  assert.equal(events[1]!.type, "signed_in");
});

test("on() returns an unsubscribe handle that actually unsubscribes", async () => {
  const calls: LoginEvent[] = [];
  const session = makeSession();
  const off = session.on("display_name_changed", (e) => calls.push(e));

  await session._dispatchDecryptedForTest({
    v: "prson_vp_v1",
    msg: "display-update",
    issuedAt: 0,
    displayName: "Alice",
  });
  assert.equal(calls.length, 1);

  off();

  await session._dispatchDecryptedForTest({
    v: "prson_vp_v1",
    msg: "display-update",
    issuedAt: 0,
    displayName: "Bob",
  });
  assert.equal(calls.length, 1, "unsubscribed listener must not fire");
});

test("display-update emits only fields that are present", async () => {
  const events: LoginEvent[] = [];
  const session = makeSession();
  session.onAny((e) => events.push(e));

  // Only displayName present
  await session._dispatchDecryptedForTest({
    v: "prson_vp_v1",
    msg: "display-update",
    issuedAt: 0,
    displayName: "Alice",
  });
  assert.deepEqual(
    events.map((e) => e.type),
    ["display_name_changed"],
  );

  // Only avatar present
  await session._dispatchDecryptedForTest({
    v: "prson_vp_v1",
    msg: "display-update",
    issuedAt: 0,
    avatar: { url: "https://x/a.png", hash: "h" },
  });
  assert.deepEqual(
    events.map((e) => e.type),
    ["display_name_changed", "avatar_changed"],
  );

  // Both present
  await session._dispatchDecryptedForTest({
    v: "prson_vp_v1",
    msg: "display-update",
    issuedAt: 0,
    displayName: null,
    avatar: null,
  });
  assert.deepEqual(
    events.map((e) => e.type),
    [
      "display_name_changed",
      "avatar_changed",
      "display_name_changed",
      "avatar_changed",
    ],
  );
});

test("credential-revoked emits the event AND then signed_out", async () => {
  const events: LoginEvent[] = [];
  const session = makeSession();
  session.onAny((e) => events.push(e));

  await session._dispatchDecryptedForTest({
    v: "prson_vp_v1",
    msg: "credential-revoked",
    issuedAt: 0,
    reason: "key_compromised",
  });

  // Order matters: credential_revoked fires before the
  // signed_out that closes the session.
  assert.deepEqual(
    events.map((e) => e.type),
    ["credential_revoked", "signed_out"],
  );
  const revoked = events[0] as Extract<LoginEvent, { type: "credential_revoked" }>;
  assert.equal(revoked.reason, "key_compromised");
  const signedOut = events[1] as Extract<LoginEvent, { type: "signed_out" }>;
  assert.equal(signedOut.reason, "credential_revoked");
});

test("revoke envelope routes to signed_out with wallet_signed_out", async () => {
  const events: LoginEvent[] = [];
  const session = makeSession();
  session.on("signed_out", (e) => events.push(e));

  await session._dispatchDecryptedForTest({
    v: "prson_vp_v1",
    msg: "revoke",
    issuedAt: 0,
  });

  assert.equal(events.length, 1);
  const e = events[0] as Extract<LoginEvent, { type: "signed_out" }>;
  assert.equal(e.reason, "wallet_signed_out");
});

test("a throwing listener doesn't block other listeners", async () => {
  const session = makeSession();
  let goodCalled = false;
  session.on("display_name_changed", () => {
    throw new Error("first listener boom");
  });
  session.on("display_name_changed", () => {
    goodCalled = true;
  });

  await session._dispatchDecryptedForTest({
    v: "prson_vp_v1",
    msg: "display-update",
    issuedAt: 0,
    displayName: "x",
  });
  assert.equal(goodCalled, true);
});

test("back-compat onExpiry receives signed_out reason", async () => {
  const reasons: string[] = [];
  const session = makeSession();
  session.onExpiry((reason) => reasons.push(reason));

  await session._dispatchDecryptedForTest({
    v: "prson_vp_v1",
    msg: "revoke",
    issuedAt: 0,
  });

  assert.deepEqual(reasons, ["wallet_signed_out"]);
});

test("after teardown, further events are dropped", async () => {
  const events: LoginEvent[] = [];
  const session = makeSession();
  session.onAny((e) => events.push(e));

  await session._dispatchDecryptedForTest({
    v: "prson_vp_v1",
    msg: "revoke",
    issuedAt: 0,
  });
  assert.equal(events.length, 1);

  // Post-teardown dispatch — must be silently dropped.
  await session._dispatchDecryptedForTest({
    v: "prson_vp_v1",
    msg: "display-update",
    issuedAt: 0,
    displayName: "ignored",
  });
  assert.equal(events.length, 1, "post-teardown event must not dispatch");
});

test("unknown msg types are silently ignored (forward-compat)", async () => {
  const events: LoginEvent[] = [];
  const session = makeSession();
  session.onAny((e) => events.push(e));

  await session._dispatchDecryptedForTest({
    v: "prson_vp_v1",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    msg: "future-event-not-yet-defined" as any,
    issuedAt: 0,
  });
  assert.equal(events.length, 0);
});
