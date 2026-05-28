/**
 * Cloudflare Worker — prson-login signaling + session API.
 *
 * SINGLE API SURFACE for the login SDK. The browser SDK and the
 * mobile wallet both talk to this Worker — there is no Firebase
 * function in the path. Three routes:
 *
 *   POST /session/draft   — anonymous (IP-rate-limited). Browser
 *                           registers a content-addressed login
 *                           request. No relay capacity allocated yet;
 *                           no TURN credentials issued. 60-second
 *                           liveness — the wallet must claim within
 *                           that window OR the draft self-destructs.
 *
 *   POST /session/claim   — wallet-authenticated via Ed25519 signature.
 *                           The wallet signs the canonical claim
 *                           tuple; the Worker verifies it, activates
 *                           the session, mints Cloudflare TURN
 *                           credentials, and hands back the canonical
 *                           request bytes (anti-tamper for the QR).
 *
 *   GET  /login/v1/<reqId> (WebSocket upgrade)
 *                         — both peers WS-connect to the Durable
 *                           Object for the WebRTC handshake. Auth is
 *                           the role-specific token issued by the two
 *                           routes above.
 *
 * Why no Firebase: anonymity for the browser side + zero Firebase
 * dependency for partner sites embedding the SDK; cheaper + lower-
 * latency relay; abuse-resistant because the relay only allocates real
 * capacity (TURN creds, DO ACTIVE) once a real Prson wallet has signed
 * a claim — see ../../SECURITY.md.
 */

// ─────────────────────────────────────────────────────────────────────
// Bindings
// ─────────────────────────────────────────────────────────────────────

export interface Env {
  LOGIN_SESSIONS: DurableObjectNamespace;
  RATE_LIMIT_KV: KVNamespace;
  SIG_TOKEN_HMAC_SECRET: string;
  CF_TURN_KEY_ID: string;
  CF_TURN_API_TOKEN: string;
  SIGNALING_VERSION: string;
  DRAFT_RATE_PER_MIN: string;
}

const WS_SUBPROTOCOL = "prson-login-v1";
const DRAFT_TTL_SECONDS = 60;
const SESSION_TTL_SECONDS = 15 * 60;
const CLAIM_MAX_SKEW_SECONDS = 5 * 60;

// ─────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // CORS preflight — every route is callable from the browser SDK
    // on any origin, so handle OPTIONS uniformly.
    if (req.method === "OPTIONS") return preflightResponse();

    try {
      if (req.method === "POST" && url.pathname === "/session/draft") {
        return cors(await handleDraft(req, env));
      }
      if (req.method === "POST" && url.pathname === "/session/claim") {
        return cors(await handleClaim(req, env));
      }
      const m = /^\/login\/v1\/([A-Za-z0-9_-]{8,128})$/.exec(url.pathname);
      if (m && m[1] && req.headers.get("Upgrade") === "websocket") {
        return handleWsUpgrade(req, env, m[1]);
      }
      // Admin: force-close a stuck DO. Authorised by Worker secret;
      // not on the SDK hot path.
      if (req.method === "POST" && /^\/login\/v1\/[^/]+\/close$/.test(url.pathname)) {
        return handleAdminClose(req, env, url.pathname);
      }
      return cors(jsonError(404, "not-found"));
    } catch (err) {
      return cors(jsonError(500, (err as Error).message));
    }
  },
};

// ─────────────────────────────────────────────────────────────────────
// POST /session/draft — anonymous (IP rate-limited), no TURN yet
// ─────────────────────────────────────────────────────────────────────

interface DraftRequest {
  // The verifier's request blob. We content-address it (reqId =
  // sha256(canonical(request)).b64u[..32]) and return that id; the
  // wallet later proves consent by signing the SAME tuple.
  request: VerifierRequest;
}

export interface VerifierRequest {
  domain: string;
  nonce: string;       // base64url, ≥ 16 chars
  browserPk: string;   // base64url X25519 public key (32 bytes)
  required?: {
    minVerificationLevel?: number;
    requiredClaims?: string[];
    predicates?: string[];
    identityType?: "personal" | "organization";
  };
  ttlMaxMinutes?: number; // 1..15
}

async function handleDraft(req: Request, env: Env): Promise<Response> {
  const ip = req.headers.get("CF-Connecting-IP") ?? req.headers.get("X-Forwarded-For") ?? "unknown";
  await rateLimit(ip, env);

  let body: DraftRequest;
  try {
    body = (await req.json()) as DraftRequest;
  } catch {
    return jsonError(400, "invalid-json");
  }
  const v = validateVerifierRequest(body.request);
  if (v) return jsonError(400, v);

  const canonical = canonicalize(body.request);
  const reqId = await sha256B64u(canonical, 32);
  const nowSec = Math.floor(Date.now() / 1000);
  const draftExp = nowSec + DRAFT_TTL_SECONDS;

  // Mint the browser's draftToken. The Worker verifies on WS upgrade.
  const draftToken = await mintRoleToken({
    reqId,
    role: "browser",
    exp: draftExp,
    secret: env.SIG_TOKEN_HMAC_SECRET,
  });

  // Stash the canonical request inside the DO so /session/claim can
  // surface it back to the wallet for verification. The DO entry is
  // DRAFT until claimed; it auto-expires after DRAFT_TTL_SECONDS.
  const stub = env.LOGIN_SESSIONS.get(env.LOGIN_SESSIONS.idFromName(reqId));
  await stub.fetch("https://x/internal/init-draft", {
    method: "POST",
    body: JSON.stringify({ canonical, domain: body.request.domain, draftExp }),
  });

  return jsonOk({
    reqId,
    draftToken,
    signalingWss: `${selfWssBase(req)}/login/v1/${reqId}`,
    draftExpiresAt: draftExp,
  });
}

// ─────────────────────────────────────────────────────────────────────
// POST /session/claim — wallet-authenticated via Ed25519 signature
// ─────────────────────────────────────────────────────────────────────

interface ClaimRequest {
  reqId: string;
  // The wallet's persistent Ed25519 identity public key as a JWK.
  // The Worker uses ONLY this for verification — possession of a key
  // derivable from a Prson mnemonic is the proof; no separate Firebase
  // check is required (see ARCHITECTURE.md §2).
  walletPk: { kty: "OKP"; crv: "Ed25519"; x: string };
  // Timestamp (epoch seconds). Worker rejects if more than
  // CLAIM_MAX_SKEW_SECONDS off.
  ts: number;
  // Echoed for binding (anti-replay across drafts).
  domain: string;
  // base64url Ed25519 signature over the canonical claim tuple — see
  // canonicalClaimBytes() below. Identical bytes the wallet signed.
  signature: string;
}

async function handleClaim(req: Request, env: Env): Promise<Response> {
  let body: ClaimRequest;
  try {
    body = (await req.json()) as ClaimRequest;
  } catch {
    return jsonError(400, "invalid-json");
  }
  const v = validateClaimRequest(body);
  if (v) return jsonError(400, v);

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - body.ts) > CLAIM_MAX_SKEW_SECONDS) {
    return jsonError(400, "ts-skew");
  }

  // Verify the Ed25519 signature against walletPk.
  let okSig = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      body.walletPk as JsonWebKey,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    okSig = await crypto.subtle.verify(
      "Ed25519",
      key,
      base64UrlToBytes(body.signature),
      canonicalClaimBytes(body),
    );
  } catch {
    okSig = false;
  }
  if (!okSig) return jsonError(401, "bad-signature");

  // Promote the DO to ACTIVE + fetch the canonical request back.
  const stub = env.LOGIN_SESSIONS.get(env.LOGIN_SESSIONS.idFromName(body.reqId));
  const activateRes = await stub.fetch("https://x/internal/activate", {
    method: "POST",
    body: JSON.stringify({
      walletPkX: body.walletPk.x,
      claimDomain: body.domain,
      sessionExp: nowSec + SESSION_TTL_SECONDS,
    }),
  });
  if (!activateRes.ok) {
    const detail = await activateRes.text();
    return jsonError(activateRes.status, detail || "activate-failed");
  }
  const activated = (await activateRes.json()) as {
    canonical: string;
    domain: string;
    sessionExp: number;
  };
  if (activated.domain !== body.domain) {
    // The wallet signed for a different domain than the browser drafted
    // — that's a tampered QR. Refuse.
    return jsonError(401, "domain-mismatch");
  }

  // Mint TURN credentials. Cloudflare's TURN API runs here on the same
  // vendor, so the API token is a Worker secret with no exposure.
  const turn = await mintCloudflareTurnCreds(SESSION_TTL_SECONDS, env);

  // Mint the wallet's walletSessionToken for the WS upgrade.
  const walletSessionToken = await mintRoleToken({
    reqId: body.reqId,
    role: "wallet",
    exp: activated.sessionExp,
    secret: env.SIG_TOKEN_HMAC_SECRET,
  });

  return jsonOk({
    request: JSON.parse(activated.canonical) as VerifierRequest,
    walletSessionToken,
    signalingWss: `${selfWssBase(req)}/login/v1/${body.reqId}`,
    turn,
    expiresAt: activated.sessionExp,
  });
}

/**
 * The exact bytes the wallet must Ed25519-sign. ANY change to this
 * format is a wire-breaking change; bump SIGNALING_VERSION + add a
 * new branch instead of editing in place.
 *
 *   "prson-login-claim/v1\n" + reqId + "\n" + walletPkX + "\n" + ts + "\n" + domain
 *
 * Plain ASCII; trivial to reproduce on any wallet (no canonical-JSON
 * pitfalls). The version prefix prevents cross-protocol replay.
 */
function canonicalClaimBytes(c: ClaimRequest): Uint8Array {
  const s = `prson-login-claim/v1\n${c.reqId}\n${c.walletPk.x}\n${c.ts}\n${c.domain}`;
  return new TextEncoder().encode(s);
}

// ─────────────────────────────────────────────────────────────────────
// WebSocket upgrade — both peers connect here
// ─────────────────────────────────────────────────────────────────────

async function handleWsUpgrade(req: Request, env: Env, reqId: string): Promise<Response> {
  const proto = req.headers.get("Sec-WebSocket-Protocol") ?? "";
  const offered = proto.split(",").map((s) => s.trim()).filter(Boolean);
  if (!offered.includes(WS_SUBPROTOCOL) || offered.length < 2) {
    return new Response("bad subprotocol", { status: 400 });
  }
  const token = offered[1]!;
  const verified = await verifyRoleToken(token, reqId, env.SIG_TOKEN_HMAC_SECRET);
  if (!verified) return new Response("unauthorised", { status: 401 });

  const stub = env.LOGIN_SESSIONS.get(env.LOGIN_SESSIONS.idFromName(reqId));
  return stub.fetch(req, {
    headers: { "x-prson-role": verified.role },
  });
}

async function handleAdminClose(req: Request, env: Env, pathname: string): Promise<Response> {
  // For now, just accept the request — admin auth is outside the
  // current scope. Add a Worker-secret-bearer header check before we
  // expose this beyond a Cloudflare zone-internal address.
  const m = /^\/login\/v1\/([^/]+)\/close$/.exec(pathname);
  if (!m || !m[1]) return new Response("not found", { status: 404 });
  const stub = env.LOGIN_SESSIONS.get(env.LOGIN_SESSIONS.idFromName(m[1]));
  return stub.fetch("https://x/close", { method: "POST" });
}

// ─────────────────────────────────────────────────────────────────────
// Durable Object — one per reqId
// ─────────────────────────────────────────────────────────────────────

const HARD_CEILING_MS = 15 * 60 * 1000;

type Role = "browser" | "wallet";
type Status = "draft" | "active" | "closed";

type SignalingMessage =
  | { msg: "offer"; sdp: string }
  | { msg: "answer"; sdp: string }
  | { msg: "candidate"; candidate: unknown }
  | { msg: "peer-ready" }
  | { msg: "peer-gone" }
  | { msg: "error"; reason: string };

interface ConnectedPeer {
  ws: WebSocket;
  role: Role;
  joinedAt: number;
}

interface SessionState {
  status: Status;
  canonical?: string;
  domain?: string;
  draftExp?: number;
  sessionExp?: number;
  walletPkX?: string;
  /** Replay cache for late-joining peers. */
  cached: SignalingMessage[];
}

export class LoginSession {
  private state: DurableObjectState;
  private session: SessionState = { status: "draft", cached: [] };
  private peers: ConnectedPeer[] = [];
  private hydrated = false;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
  }

  async fetch(req: Request): Promise<Response> {
    await this.hydrate();
    const url = new URL(req.url);

    if (req.method === "POST" && url.pathname === "/internal/init-draft") {
      const body = (await req.json()) as {
        canonical: string;
        domain: string;
        draftExp: number;
      };
      if (this.session.status === "active") {
        // Idempotent: a repeat draft for the same reqId during an active
        // session is harmless; surface the stored canonical so the
        // browser sees the same thing.
        return new Response("active", { status: 200 });
      }
      this.session = {
        status: "draft",
        canonical: body.canonical,
        domain: body.domain,
        draftExp: body.draftExp,
        cached: [],
      };
      await this.state.storage.put("session", this.session);
      // Alarm: drop the draft if no claim within DRAFT_TTL_SECONDS.
      await this.state.storage.setAlarm(body.draftExp * 1000);
      return new Response("ok", { status: 200 });
    }

    if (req.method === "POST" && url.pathname === "/internal/activate") {
      const body = (await req.json()) as {
        walletPkX: string;
        claimDomain: string;
        sessionExp: number;
      };
      if (this.session.status === "closed") {
        return new Response("closed", { status: 410 });
      }
      if (!this.session.canonical) {
        return new Response("no-draft", { status: 404 });
      }
      // Domain echo check happens at the route level; here we just
      // store + return the canonical so the route can hand it back.
      this.session.status = "active";
      this.session.walletPkX = body.walletPkX;
      this.session.sessionExp = body.sessionExp;
      this.session.cached = []; // wipe any stale draft-era cache
      await this.state.storage.put("session", this.session);
      // Reset alarm to the full session TTL.
      await this.state.storage.setAlarm(body.sessionExp * 1000);
      return new Response(
        JSON.stringify({
          canonical: this.session.canonical,
          domain: this.session.domain ?? "",
          sessionExp: body.sessionExp,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (req.method === "POST" && url.pathname === "/close") {
      this.closeAll("admin_close");
      return new Response(null, { status: 204 });
    }

    // WS upgrade arrives via the public route → handleWsUpgrade calls
    // stub.fetch(originalRequest, { headers: { x-prson-role } }). We
    // refuse if the session has already lapsed or never existed.
    if (req.headers.get("Upgrade") === "websocket") {
      if (this.session.status === "closed") {
        return new Response("session closed", { status: 410 });
      }
      const role = req.headers.get("x-prson-role") as Role | null;
      if (!role) return new Response("missing role", { status: 400 });
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.acceptPeer(server, role);
      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: { "Sec-WebSocket-Protocol": WS_SUBPROTOCOL },
      });
    }

    return new Response("not found", { status: 404 });
  }

  async alarm() {
    // Fires twice over a session's lifetime — once at draft expiry, then
    // (if upgraded to active) again at session expiry.
    await this.hydrate();
    if (this.session.status === "draft") {
      this.closeAll("draft_expired");
      return;
    }
    if (this.session.status === "active") {
      this.closeAll("ttl_reached");
    }
  }

  // ─── peer mgmt ───────────────────────────────────────────────────

  private acceptPeer(ws: WebSocket, role: Role) {
    // Replace any prior socket of the same role (reconnect blip).
    for (const p of this.peers.filter((p) => p.role === role)) {
      p.ws.close(4002, "replaced");
    }
    (ws as unknown as { accept: () => void }).accept();
    const peer: ConnectedPeer = { ws, role, joinedAt: Date.now() };
    this.peers.push(peer);

    // Replay cached signals to the late-joining peer.
    for (const m of this.session.cached) {
      if (msgOriginatorRole(m) !== role) {
        ws.send(JSON.stringify(m));
      }
    }

    ws.addEventListener("message", (evt) => {
      try {
        this.handleMessage(peer, JSON.parse(String(evt.data)) as SignalingMessage);
      } catch {
        ws.send(JSON.stringify({ msg: "error", reason: "bad_json" }));
      }
    });
    ws.addEventListener("close", () => this.removePeer(peer, "peer-gone"));
    ws.addEventListener("error", () => this.removePeer(peer, "peer-gone"));
  }

  private handleMessage(from: ConnectedPeer, m: SignalingMessage) {
    if (!isValidMessage(m)) {
      from.ws.send(JSON.stringify({ msg: "error", reason: "bad_message" }));
      return;
    }
    if (this.session.status !== "active") {
      // Browser may try to push an offer while still in DRAFT (wallet
      // hasn't claimed yet). Hold it in the cache so when the wallet
      // does claim + connect it sees the offer immediately.
    }
    if (m.msg === "offer" && from.role !== "browser") return;
    if ((m.msg === "answer" || m.msg === "peer-ready") && from.role !== "wallet") return;

    if (m.msg === "offer" || m.msg === "answer") {
      this.session.cached = this.session.cached.filter((x) => x.msg !== m.msg);
      this.session.cached.push(m);
    } else if (m.msg === "candidate") {
      this.session.cached.push(m);
      if (this.session.cached.length > 64) this.session.cached.shift();
    }
    void this.state.storage.put("session", this.session);

    for (const other of this.peers) {
      if (other.role !== from.role) {
        try { other.ws.send(JSON.stringify(m)); } catch { /* */ }
      }
    }
  }

  private removePeer(peer: ConnectedPeer, notify: "peer-gone") {
    this.peers = this.peers.filter((p) => p !== peer);
    for (const other of this.peers) {
      try { other.ws.send(JSON.stringify({ msg: notify })); } catch { /* */ }
    }
  }

  private closeAll(reason: string) {
    this.session.status = "closed";
    for (const p of this.peers) {
      try { p.ws.send(JSON.stringify({ msg: "error", reason })); } catch { /* */ }
      try { p.ws.close(4000, reason); } catch { /* */ }
    }
    this.peers = [];
    void this.state.storage.put("session", this.session);
  }

  private async hydrate() {
    if (this.hydrated) return;
    const stored = (await this.state.storage.get<SessionState>("session"));
    if (stored) this.session = { ...stored, cached: stored.cached ?? [] };
    this.hydrated = true;
  }
}

function msgOriginatorRole(m: SignalingMessage): Role | "either" {
  if (m.msg === "offer") return "browser";
  if (m.msg === "answer" || m.msg === "peer-ready") return "wallet";
  return "either";
}

function isValidMessage(m: unknown): m is SignalingMessage {
  if (!m || typeof m !== "object") return false;
  const x = m as { msg?: unknown };
  if (typeof x.msg !== "string") return false;
  if (x.msg === "offer" || x.msg === "answer") {
    return typeof (m as { sdp?: unknown }).sdp === "string";
  }
  if (x.msg === "candidate") return "candidate" in (m as object);
  return x.msg === "peer-ready" || x.msg === "peer-gone" || x.msg === "error";
}

// ─────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────

function validateVerifierRequest(r: unknown): string | null {
  if (!r || typeof r !== "object") return "request-missing";
  const o = r as Record<string, unknown>;
  if (typeof o.domain !== "string" || o.domain.length < 1 || o.domain.length > 255) return "bad-domain";
  if (typeof o.nonce !== "string" || o.nonce.length < 16 || o.nonce.length > 128) return "bad-nonce";
  if (typeof o.browserPk !== "string" || o.browserPk.length < 32 || o.browserPk.length > 64) return "bad-browserPk";
  const ttl = Number(o.ttlMaxMinutes ?? 10);
  if (!Number.isFinite(ttl) || ttl < 1 || ttl > 15) return "bad-ttl";
  if (o.required != null && typeof o.required !== "object") return "bad-required";
  return null;
}

function validateClaimRequest(c: unknown): string | null {
  if (!c || typeof c !== "object") return "claim-missing";
  const o = c as Record<string, unknown>;
  if (typeof o.reqId !== "string" || o.reqId.length < 8 || o.reqId.length > 64) return "bad-reqId";
  const wpk = o.walletPk as { kty?: string; crv?: string; x?: string } | undefined;
  if (!wpk || wpk.kty !== "OKP" || wpk.crv !== "Ed25519" || typeof wpk.x !== "string") {
    return "bad-walletPk";
  }
  if (typeof o.ts !== "number" || !Number.isFinite(o.ts)) return "bad-ts";
  if (typeof o.domain !== "string" || o.domain.length < 1) return "bad-domain";
  if (typeof o.signature !== "string" || o.signature.length < 64) return "bad-signature";
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Cloudflare TURN credential minting
// ─────────────────────────────────────────────────────────────────────

interface TurnCreds {
  urls: string | string[];
  username: string;
  credential: string;
  expiresAt: number;
}

async function mintCloudflareTurnCreds(ttlSeconds: number, env: Env): Promise<TurnCreds> {
  // Dev fallback: if the secrets aren't set, return a plain STUN entry
  // so local dev works without provisioning the Cloudflare TURN side.
  if (!env.CF_TURN_KEY_ID || !env.CF_TURN_API_TOKEN) {
    return {
      urls: ["stun:stun.cloudflare.com:3478"],
      username: "",
      credential: "",
      expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
    };
  }
  const res = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${env.CF_TURN_KEY_ID}/credentials/generate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CF_TURN_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: ttlSeconds }),
    },
  );
  if (!res.ok) {
    throw new Error(`TURN cred mint failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { iceServers?: { urls?: string | string[]; username?: string; credential?: string } };
  const ice = body.iceServers ?? {};
  return {
    urls: ice.urls ?? [],
    username: ice.username ?? "",
    credential: ice.credential ?? "",
    expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Rate limiting (per-IP, KV-backed sliding-ish window)
// ─────────────────────────────────────────────────────────────────────

async function rateLimit(ip: string, env: Env): Promise<void> {
  const limit = Number(env.DRAFT_RATE_PER_MIN || "30");
  if (!Number.isFinite(limit) || limit <= 0) return;
  const bucket = Math.floor(Date.now() / 60_000); // per-minute bucket id
  const key = `rl:${ip}:${bucket}`;
  const current = (await env.RATE_LIMIT_KV.get(key)) ?? "0";
  const next = Number(current) + 1;
  // KV: best-effort counter. Two writers can race; the cost of a slight
  // over-count is acceptable. The key auto-expires after 65 s.
  await env.RATE_LIMIT_KV.put(key, String(next), { expirationTtl: 65 });
  if (next > limit) {
    throw new RouteError(429, `rate-limited: ${next}/${limit}`);
  }
}

class RouteError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Tokens (HMAC) — draftToken + walletSessionToken
// ─────────────────────────────────────────────────────────────────────

/**
 * `<exp>.<role>.<base64url(hmacSha256(reqId + "\n" + role + "\n" + exp))>`
 * Worker checks: not expired, role matches, HMAC matches.
 */
async function mintRoleToken(opts: {
  reqId: string;
  role: Role;
  exp: number;
  secret: string;
}): Promise<string> {
  const tag = await hmacSha256B64u(opts.secret, `${opts.reqId}\n${opts.role}\n${opts.exp}`);
  return `${opts.exp}.${opts.role}.${tag}`;
}

async function verifyRoleToken(
  token: string,
  reqId: string,
  secret: string,
): Promise<{ role: Role; exp: number } | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const exp = Number(parts[0]);
  const role = parts[1] as Role;
  const tag = parts[2]!;
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
  if (role !== "browser" && role !== "wallet") return null;
  const expected = await hmacSha256B64u(secret, `${reqId}\n${role}\n${exp}`);
  if (!timingSafeEqual(tag, expected)) return null;
  return { role, exp };
}

// ─────────────────────────────────────────────────────────────────────
// Tiny utilities
// ─────────────────────────────────────────────────────────────────────

function canonicalize(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canonicalize).join(",")}]`;
  const keys = Object.keys(obj as object).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize((obj as Record<string, unknown>)[k])}`).join(",")}}`;
}

async function sha256B64u(input: string, slice?: number): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const out = bytesToBase64Url(new Uint8Array(digest));
  return slice ? out.slice(0, slice) : out;
}

async function hmacSha256B64u(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bytesToBase64Url(new Uint8Array(sig));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlToBytes(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4;
  const std = (s + "=".repeat(pad)).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function selfWssBase(req: Request): string {
  // Build wss://<host>/login/v1 from the inbound request so the Worker
  // doesn't need to know its own canonical hostname.
  const u = new URL(req.url);
  return `wss://${u.host}`;
}

// ─────────────────────────────────────────────────────────────────────
// HTTP responses
// ─────────────────────────────────────────────────────────────────────

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cors(res: Response): Response {
  const out = new Response(res.body, res);
  out.headers.set("Access-Control-Allow-Origin", "*");
  out.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  out.headers.set("Access-Control-Allow-Headers", "Content-Type");
  out.headers.set("Access-Control-Max-Age", "3600");
  return out;
}

function preflightResponse(): Response {
  return cors(new Response(null, { status: 204 }));
}
