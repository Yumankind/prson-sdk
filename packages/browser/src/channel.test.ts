/**
 * Envelope v2 / channel-hardening tests:
 *
 *   * sender pinning — only boxes from the pinned wallet session key
 *     open; a box from another key (or one that lies about `ephPk`) is
 *     dropped, and `walletSessionPk` on an envelope can't swap the key;
 *   * key rotation — accepted only from a verified renewal presentation
 *     carrying the new `prson_wsk`;
 *   * renewal anti-replay — strictly newer `iat`, no repeated presentation;
 *   * outbound boxes are made BY the browser's session key;
 *   * password / one-time-code fields never cross the channel;
 *   * relay-only ICE config + waiting for the relay's `ice` message.
 *
 * Presentations are anonymous-wallet credentials (self-signed Ed25519),
 * so no issuer JWKS is needed.
 */
import test from "node:test";
import { strict as assert } from "node:assert";
import { box, openBox } from "@stablelib/nacl";
import { generateKeyPair } from "@stablelib/x25519";
import { randomBytes } from "@stablelib/random";
import { decodeURLSafe, encodeURLSafe } from "@stablelib/base64";

import { PrsonLoginSession, type LoginEvent } from "./session.js";
import type { Transport } from "./transport.js";
import { rtcConfigFor } from "./transport.js";
import { connectSignaling } from "./signaling.js";
import { boxToWallet, openEnvelope, type EphemeralKeys } from "./crypto.js";
import { isSensitiveField } from "./bind.js";

const ANON_VCT = "https://app.prson.net/credentials/anonymous-wallet/v1";
const AUD = "https://example.com";
const NONCE = "n0nce-n0nce-n0nce-n0nce";

const b64u = (b: Uint8Array) => encodeURLSafe(b).replace(/=+$/, "");
const unb64u = (s: string) => decodeURLSafe(s + "=".repeat((4 - (s.length % 4)) % 4));
const jsonB64u = (o: unknown) => b64u(new TextEncoder().encode(JSON.stringify(o)));

type X = { publicKey: Uint8Array; secretKey: Uint8Array };

function browserKeys(): EphemeralKeys {
  const kp = generateKeyPair();
  return { ...kp, publicKeyB64u: b64u(kp.publicKey) };
}

/** What the wallet puts on the wire: box(sender sk → browserPk), `ephPk` = [claimedSender ?? sender]. */
function walletBox(sender: X, browserPk: Uint8Array, body: Record<string, unknown>, claimedSender?: Uint8Array): string {
  const nonce = randomBytes(24);
  const ct = box(browserPk, sender.secretKey, nonce, new TextEncoder().encode(JSON.stringify(body)));
  return JSON.stringify({ ephPk: b64u(claimedSender ?? sender.publicKey), nonce24: b64u(nonce), ct: b64u(ct) });
}

/** The holder's Ed25519 key + an anonymous-wallet credential builder. */
async function makeHolder() {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const x = jwk.x!;
  async function presentation(iat: number, wsk?: string): Promise<string> {
    const h = jsonB64u({ typ: "anon-wallet+jwt", alg: "EdDSA" });
    const p = jsonB64u({
      iss: "example.com",
      aud: AUD,
      nonce: NONCE,
      iat,
      exp: iat + 600,
      vct: ANON_VCT,
      cnf: { jwk: { kty: "OKP", crv: "Ed25519", x } },
      ...(wsk ? { prson_wsk: wsk } : {}),
    });
    const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", kp.privateKey, new TextEncoder().encode(`${h}.${p}`)));
    return `${h}.${p}.${b64u(sig)}`;
  }
  return { x, presentation };
}

function makeTransport() {
  const sent: string[] = [];
  let deliver: (raw: string) => void = () => {};
  const transport = {
    onMessage: (cb: (raw: string) => void) => {
      deliver = cb;
    },
    onClose: () => {},
    send: (raw: string) => sent.push(raw),
    awaitFirstMessage: async () => "" as never,
    awaitNextMessage: async () => "" as never,
    close: () => {},
  } as unknown as Transport;
  return { transport, sent, push: (raw: string) => deliver(raw) };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

async function makeSession(opts?: { legacy?: boolean; firstIat?: number }) {
  const browser = browserKeys();
  const wallet = generateKeyPair();
  const holder = await makeHolder();
  const now = Math.floor(Date.now() / 1000);
  const first = await holder.presentation(opts?.firstIat ?? now - 20, opts?.legacy ? undefined : b64u(wallet.publicKey));
  const t = makeTransport();
  const session = new PrsonLoginSession({
    cnf: { jwk: { kty: "OKP", crv: "Ed25519", x: holder.x } },
    credential: { expiresAt: Date.now() + 3_600_000 },
    transport: t.transport,
    ephKeys: browser,
    verifierContext: {
      expectedAudience: AUD,
      expectedNonceFactory: () => NONCE,
      acceptedVcts: [ANON_VCT],
      trustedIssuer: "did:web:app.prson.net",
    },
    walletSessionPk: b64u(wallet.publicKey),
    legacyChannel: opts?.legacy === true,
    initialPresentation: { presentation: first, iat: opts?.firstIat ?? now - 20 },
  });
  const events: LoginEvent[] = [];
  session.onAny((e) => events.push(e));
  await settle();
  return { session, browser, wallet, holder, t, events, first, now };
}

const display = (name: string) => ({ v: "prson_vp_v1", msg: "display-update", issuedAt: 0, displayName: name });

// ─── Sender pinning ────────────────────────────────────────────────

test("an envelope boxed by the pinned wallet key is accepted", async () => {
  const s = await makeSession();
  s.t.push(walletBox(s.wallet, s.browser.publicKey, display("Alice")));
  await settle();
  assert.equal(s.session.displayName, "Alice");
  s.session.close();
});

test("an envelope from another key is dropped, even boxed to browserPk (which is in the QR)", async () => {
  const s = await makeSession();
  const attacker = generateKeyPair();
  s.t.push(walletBox(attacker, s.browser.publicKey, display("Mallory")));
  await settle();
  assert.equal(s.session.displayName, null);
  // Lying about the sender doesn't help: the box won't open with the pinned key.
  s.t.push(walletBox(attacker, s.browser.publicKey, display("Mallory"), s.wallet.publicKey));
  await settle();
  assert.equal(s.session.displayName, null);
  // Nor can it log the page out or drive it.
  s.t.push(walletBox(attacker, s.browser.publicKey, { v: "prson_vp_v1", msg: "logout", issuedAt: 0 }));
  await settle();
  assert.ok(!s.events.some((e) => e.type === "signed_out"));
  s.session.close();
});

test("walletSessionPk on an envelope can't swap the key the page sends to", async () => {
  const s = await makeSession();
  const attacker = generateKeyPair();
  const pinned = b64u(s.wallet.publicKey);
  s.t.push(walletBox(s.wallet, s.browser.publicKey, { ...display("Alice"), walletSessionPk: b64u(attacker.publicKey) }));
  await settle();
  assert.equal(s.session.walletSessionPk, pinned);
  s.session.close();
});

test("outbound envelopes are boxed BY browserPk to the pinned wallet key", async () => {
  const s = await makeSession();
  await s.session._sendControlStatus(true);
  assert.equal(s.t.sent.length, 1);
  const env = JSON.parse(s.t.sent[0]!) as { ephPk: string; nonce24: string; ct: string };
  assert.equal(env.ephPk, s.browser.publicKeyB64u);
  const pt = openBox(s.browser.publicKey, s.wallet.secretKey, unb64u(env.nonce24), unb64u(env.ct));
  assert.ok(pt, "the wallet opens it with the browser's session key as sender");
  assert.equal(JSON.parse(new TextDecoder().decode(pt!)).msg, "control-status");
  s.session.close();
});

test("openEnvelope with a pinned sender rejects other senders", async () => {
  const browser = browserKeys();
  const wallet = generateKeyPair();
  const other = generateKeyPair();
  const raw = walletBox(wallet, browser.publicKey, display("x"));
  const ok = await openEnvelope(raw, browser, b64u(wallet.publicKey));
  assert.equal(ok.senderPk, b64u(wallet.publicKey));
  await assert.rejects(openEnvelope(raw, browser, b64u(other.publicKey)));
});

test("boxToWallet without a sender still uses a fresh key (legacy)", () => {
  const wallet = generateKeyPair();
  const env = JSON.parse(boxToWallet(b64u(wallet.publicKey), "{}")) as { ephPk: string };
  assert.equal(unb64u(env.ephPk).length, 32);
});

// ─── Key rotation ──────────────────────────────────────────────────

test("a verified renewal carrying a new prson_wsk rotates the pinned key", async () => {
  const s = await makeSession();
  const next = generateKeyPair();
  const renewal = await s.holder.presentation(s.now - 5, b64u(next.publicKey));
  // Boxed by the CURRENT key; signs the next one.
  s.t.push(walletBox(s.wallet, s.browser.publicKey, { v: "prson_vp_v1", msg: "renewal", issuedAt: 0, presentation: renewal }));
  await settle();
  assert.ok(s.events.some((e) => e.type === "renewed"));
  assert.equal(s.session.walletSessionPk, b64u(next.publicKey));
  // The old key no longer talks to the page; the new one does.
  s.t.push(walletBox(s.wallet, s.browser.publicKey, display("Old")));
  await settle();
  assert.equal(s.session.displayName, null);
  s.t.push(walletBox(next, s.browser.publicKey, display("New")));
  await settle();
  assert.equal(s.session.displayName, "New");
  s.session.close();
});

test("a renewal signed by another holder doesn't rotate the key", async () => {
  const s = await makeSession();
  const other = await makeHolder();
  const evil = generateKeyPair();
  const renewal = await other.presentation(s.now - 5, b64u(evil.publicKey));
  s.t.push(walletBox(s.wallet, s.browser.publicKey, { v: "prson_vp_v1", msg: "renewal", issuedAt: 0, presentation: renewal }));
  await settle();
  assert.ok(!s.events.some((e) => e.type === "renewed"));
  assert.equal(s.session.walletSessionPk, b64u(s.wallet.publicKey));
  s.session.close();
});

// ─── Renewal anti-replay ───────────────────────────────────────────

test("renewals need a strictly newer iat and are never accepted twice", async () => {
  const s = await makeSession();
  const wsk = b64u(s.wallet.publicKey);
  const renew = (presentation: string) =>
    s.t.push(walletBox(s.wallet, s.browser.publicKey, { v: "prson_vp_v1", msg: "renewal", issuedAt: 0, presentation }));
  const renewedCount = () => s.events.filter((e) => e.type === "renewed").length;

  // The sign-in presentation itself, replayed: refused.
  renew(s.first);
  await settle();
  assert.equal(renewedCount(), 0);

  // Older than the sign-in: refused.
  renew(await s.holder.presentation(s.now - 30, wsk));
  await settle();
  assert.equal(renewedCount(), 0);

  // Newer: accepted once.
  const fresh = await s.holder.presentation(s.now - 10, wsk);
  renew(fresh);
  await settle();
  assert.equal(renewedCount(), 1);

  // The same one again: refused.
  renew(fresh);
  await settle();
  assert.equal(renewedCount(), 1);

  // Same iat as the last accepted, different bytes: refused.
  renew(await s.holder.presentation(s.now - 10, wsk));
  await settle();
  assert.equal(renewedCount(), 1);
  s.session.close();
});

// ─── Legacy wallets ────────────────────────────────────────────────

test("a legacy session (no bound key) ignores page-acting envelopes", async () => {
  const s = await makeSession({ legacy: true });
  const navs: unknown[] = [];
  s.session._setRemoteNavListener((e) => navs.push(e));
  const anyone = generateKeyPair();
  s.t.push(walletBox(anyone, s.browser.publicKey, { v: "prson_vp_v1", msg: "nav", issuedAt: 0, action: "next" }));
  s.t.push(walletBox(anyone, s.browser.publicKey, { v: "prson_vp_v1", msg: "value", issuedAt: 0, value: "x" }));
  await settle();
  assert.equal(navs.length, 0);
  // Cosmetic updates still flow.
  s.t.push(walletBox(anyone, s.browser.publicKey, display("Legacy")));
  await settle();
  assert.equal(s.session.displayName, "Legacy");
  s.session.close();
});

// ─── Sensitive fields ──────────────────────────────────────────────

function fakeEl(attrs: Record<string, string>): Element {
  return { getAttribute: (n: string) => attrs[n] ?? null } as unknown as Element;
}

test("password and one-time-code fields are sensitive; others aren't", () => {
  assert.equal(isSensitiveField(fakeEl({ type: "password" })), true);
  assert.equal(isSensitiveField(fakeEl({ type: "PASSWORD" })), true);
  assert.equal(isSensitiveField(fakeEl({ type: "text", autocomplete: "current-password" })), true);
  assert.equal(isSensitiveField(fakeEl({ autocomplete: "section-login new-password" })), true);
  assert.equal(isSensitiveField(fakeEl({ type: "text", autocomplete: "one-time-code" })), true);
  assert.equal(isSensitiveField(fakeEl({ type: "email", autocomplete: "username" })), false);
  assert.equal(isSensitiveField(fakeEl({ type: "text" })), false);
});

test("an input request never carries a password's current value", async () => {
  const s = await makeSession();
  void s.session.request({ kind: "input", inputType: "password", label: "Password", defaultValue: "hunter2" }, { timeoutMs: 50 });
  void s.session.request(
    { kind: "input-form", fields: [{ name: "pw", inputType: "password", label: "Password", defaultValue: "hunter2" }] },
    { timeoutMs: 50 },
  );
  for (const raw of s.t.sent) {
    const env = JSON.parse(raw) as { nonce24: string; ct: string };
    const pt = openBox(s.browser.publicKey, s.wallet.secretKey, unb64u(env.nonce24), unb64u(env.ct))!;
    assert.ok(!new TextDecoder().decode(pt).includes("hunter2"));
  }
  assert.equal(s.t.sent.length, 2);
  s.session.close();
});

// ─── ICE: relay-only, after the claim ──────────────────────────────

test("rtcConfigFor keeps only TURN servers and goes relay-only", () => {
  const cfg = rtcConfigFor([
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "stun:x:3478", "turns:turn.cloudflare.com:443"], username: "u", credential: "c" },
  ]);
  assert.equal(cfg.iceTransportPolicy, "relay");
  assert.deepEqual(cfg.iceServers, [
    { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443"], username: "u", credential: "c" },
  ]);
});

test("rtcConfigFor without TURN (dev relay) falls back to all candidates", () => {
  const cfg = rtcConfigFor([{ urls: ["stun:stun.cloudflare.com:3478"], username: "", credential: "" }]);
  assert.equal(cfg.iceTransportPolicy, "all");
});

class FakeWebSocket extends EventTarget {
  static OPEN = 1;
  static last: FakeWebSocket | null = null;
  readyState = 0;
  sent: string[] = [];
  constructor(_url: string, _protocols: string[]) {
    super();
    FakeWebSocket.last = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
    });
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
  }
  emit(data: unknown) {
    const e = new Event("message") as Event & { data: string };
    e.data = JSON.stringify(data);
    this.dispatchEvent(e);
  }
  emitClose(reason: string) {
    const e = new Event("close") as Event & { reason: string; code: number };
    e.reason = reason;
    e.code = 4000;
    this.dispatchEvent(e);
  }
}

test("signaling buffers the relay's ice message until asked, and ignores later ones", async () => {
  const g = globalThis as unknown as { WebSocket: unknown };
  const real = g.WebSocket;
  g.WebSocket = FakeWebSocket;
  try {
    const sig = await connectSignaling({ url: "wss://x", role: "browser", sigToken: "t" });
    const ws = FakeWebSocket.last!;
    const seen: unknown[] = [];
    sig.onMessage((m) => seen.push(m));
    ws.emit({ type: "ice", iceServers: [{ urls: "turn:a", username: "u", credential: "c" }] });
    ws.emit({ type: "ice", iceServers: [{ urls: "turn:evil" }] });
    const servers = await sig.awaitIce();
    assert.deepEqual(servers, [{ urls: "turn:a", username: "u", credential: "c" }]);
    assert.equal(seen.length, 0, "ice isn't a peer message");
  } finally {
    g.WebSocket = real;
  }
});

test("waiting for ice fails when the relay closes the socket first", async () => {
  const g = globalThis as unknown as { WebSocket: unknown };
  const real = g.WebSocket;
  g.WebSocket = FakeWebSocket;
  try {
    const sig = await connectSignaling({ url: "wss://x", role: "browser", sigToken: "t" });
    const wait = sig.awaitIce();
    FakeWebSocket.last!.emitClose("ttl_reached");
    await assert.rejects(wait, /closed before the code was claimed/);
  } finally {
    g.WebSocket = real;
  }
});
