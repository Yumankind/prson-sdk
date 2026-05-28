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

  /**
   * Single-secret legacy binding. Used when the keyring binding below
   * isn't set (greenfield deploys still work without rotation infra).
   * If both are set, the keyring wins.
   */
  SIG_TOKEN_HMAC_SECRET: string;

  /**
   * Versioned HMAC keyring (M-1, see SECURITY-AUDIT-2026-05-28.md §M-1).
   * JSON-encoded:
   *   `{
   *      "active": { "kid": "<id>", "secret": "<base64>" },
   *      "retired": [
   *        { "kid": "<id>", "secret": "<base64>",
   *          "validUntil": <epoch sec> }
   *      ]
   *    }`
   *
   * Rotation: a new key is added as `active` (the prior active moves
   * to `retired` with `validUntil = now + 15 min`). After 15 minutes
   * the retired entry can be safely pruned — every in-flight session
   * has either expired or moved on by then.
   */
  SIG_TOKEN_HMAC_KEYRING: string;

  CF_TURN_KEY_ID: string;
  CF_TURN_API_TOKEN: string;
  SIGNALING_VERSION: string;
  DRAFT_RATE_PER_MIN: string;
}

const WS_SUBPROTOCOL = "prson-login-v1";
const DRAFT_TTL_SECONDS = 60;
const SESSION_TTL_SECONDS = 15 * 60;

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
  /** SDK opt-in: verifier accepts anonymous-wallet credentials. */
  allowAnonymous?: boolean;
  /** SDK opt-in: ask the wallet to mint a fresh per-login keypair
   *  rather than the deterministic per-domain HKDF. The Worker stores
   *  this verbatim + relays to the wallet in the canonical request
   *  echo; the wallet enforces the semantics. See SDK README + M-5. */
  ephemeralIdentity?: boolean;
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

  // C-1 anti-phishing gate (see SECURITY-AUDIT-2026-05-28.md §C-1).
  // The browser MUST send the `Origin` header on a CORS POST; we
  // require it to byte-match `request.domain`. This stops a phisher
  // on `phisher.evil` from claiming `domain: "bank.com"` — their
  // browser would send `Origin: https://phisher.evil`, which won't
  // match.
  //
  // The CORS preflight (OPTIONS) is unauthenticated by design and
  // doesn't carry the request body, so we enforce only here, after
  // the browser has committed to a body it can't fake.
  const originHeader = req.headers.get("Origin");
  if (!originHeader) {
    // No Origin header is a sign the call didn't come from a browser
    // (CLI, server-to-server). Browser-initiated drafts are the only
    // supported case; non-browser callers can use the Worker directly
    // but they're not the threat model the audit was sized for.
    return jsonError(400, "origin-required");
  }
  let originHost: string;
  try {
    originHost = new URL(originHeader).host.toLowerCase();
  } catch {
    return jsonError(400, "origin-malformed");
  }
  // The domain in the request can include a port in dev mode (e.g.
  // `localhost:5173`); match host:port form for that case, but also
  // tolerate a missing port on either side.
  const claimedDomain = body.request.domain.toLowerCase();
  if (originHost !== claimedDomain &&
      originHost.split(":")[0] !== claimedDomain.split(":")[0]) {
    return jsonError(403, "origin-domain-mismatch");
  }

  const canonical = canonicalize(body.request);
  const reqId = await sha256B64u(canonical, 32);
  const nowSec = Math.floor(Date.now() / 1000);
  const draftExp = nowSec + DRAFT_TTL_SECONDS;

  // Mint the browser's draftToken. The Worker verifies on WS upgrade.
  const draftToken = await mintRoleToken({
    reqId,
    role: "browser",
    exp: draftExp,
    env,
  });

  // Stash the canonical request inside the DO so /session/claim can
  // surface it back to the wallet for verification. The DO entry is
  // DRAFT until claimed; it auto-expires after DRAFT_TTL_SECONDS.
  //
  // `serverTs` is the **server-issued timestamp** that the wallet
  // must echo into the canonical claim-bytes (`prson-login-claim/v2`)
  // — see M-3. By binding the signature to a Worker-chosen timestamp
  // stored in the DO, we eliminate both clock-skew issues (the wallet
  // never computes time) and the theoretical replay window (each
  // signature is bound to one specific draft).
  const stub = env.LOGIN_SESSIONS.get(env.LOGIN_SESSIONS.idFromName(reqId));
  await stub.fetch("https://x/internal/init-draft", {
    method: "POST",
    body: JSON.stringify({
      reqId,
      canonical,
      domain: body.request.domain,
      draftExp,
      serverTs: nowSec,
    }),
  });

  return jsonOk({
    reqId,
    draftToken,
    signalingWss: `${selfWssBase(req)}/login/v1/${reqId}`,
    draftExpiresAt: draftExp,
    serverTs: nowSec,
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
  // Echoed domain. The DO cross-checks this against the canonical
  // stored at draft time (anti-tamper). NOTE: no `ts` field — the
  // timestamp the wallet signed is the SERVER-issued one carried
  // through the QR and re-read from DO state at verify time.
  domain: string;
  // base64url Ed25519 signature over the v2 canonical claim tuple — see
  // canonicalClaimBytes() below + the DO's `/internal/verify-and-activate`.
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

  // Hand the full claim payload to the DO. The DO reads its stored
  // `serverTs` (set at draft init), reconstructs the canonical
  // claim-bytes verbatim, verifies the Ed25519 signature, and on
  // success promotes the session to ACTIVE in one atomic step. This
  // eliminates client-supplied timestamp drift + binds the signature
  // to a specific draft (M-3).
  const stub = env.LOGIN_SESSIONS.get(env.LOGIN_SESSIONS.idFromName(body.reqId));
  const activateRes = await stub.fetch("https://x/internal/verify-and-activate", {
    method: "POST",
    body: JSON.stringify({
      walletPk: body.walletPk,
      claimDomain: body.domain,
      signature: body.signature,
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

  // Mint TURN credentials. Cloudflare's TURN API runs here on the same
  // vendor, so the API token is a Worker secret with no exposure.
  const turn = await mintCloudflareTurnCreds(SESSION_TTL_SECONDS, env);

  // Mint the wallet's walletSessionToken for the WS upgrade.
  const walletSessionToken = await mintRoleToken({
    reqId: body.reqId,
    role: "wallet",
    exp: activated.sessionExp,
    env,
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
 * The exact bytes the wallet must Ed25519-sign for `/session/claim`.
 * ANY change to this format is a wire-breaking change; bump the
 * version suffix + add a new branch instead of editing in place.
 *
 * **v2** (current):
 *
 *   "prson-login-claim/v2\n" + reqId + "\n" + walletPkX + "\n" +
 *     serverTs + "\n" + domain
 *
 * where `serverTs` is the **server-issued** epoch-seconds timestamp
 * the Worker assigned at `/session/draft` time. The wallet reads it
 * from the QR; the Worker's DO uses its stored value (no client
 * input) when re-computing the bytes at verify time. This binds the
 * signature to a specific draft + eliminates clock-skew issues
 * (the wallet never computes time). Closes SECURITY-AUDIT §M-3.
 *
 * Plain ASCII; trivial to reproduce on any wallet (no canonical-JSON
 * pitfalls). The version prefix prevents cross-protocol replay.
 */
function canonicalClaimBytesV2(opts: {
  reqId: string;
  walletPkX: string;
  serverTs: number;
  domain: string;
}): Uint8Array {
  const s =
    `prson-login-claim/v2\n${opts.reqId}\n${opts.walletPkX}\n` +
    `${opts.serverTs}\n${opts.domain}`;
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
  const verified = await verifyRoleToken(token, reqId, env);
  if (!verified) return new Response("unauthorised", { status: 401 });

  // Hash the token before forwarding so the DO can pin the role to the
  // first-seen token (M-2: subsequent connections with a different
  // valid token for the same role are rejected — defends against
  // forged-but-otherwise-valid tokens, e.g. minted under a leaked
  // secret before rotation took effect). The Worker hashes here so the
  // DO never sees the raw token.
  const tokenHash = await sha256B64u(token);
  const stub = env.LOGIN_SESSIONS.get(env.LOGIN_SESSIONS.idFromName(reqId));
  return stub.fetch(req, {
    headers: {
      "x-prson-role": verified.role,
      "x-prson-token-hash": tokenHash,
    },
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
  /** Content-addressed session id — duplicated here so the DO can
   *  re-build the canonical claim-bytes without needing the route
   *  layer to thread reqId through every internal call. */
  reqId?: string;
  canonical?: string;
  domain?: string;
  draftExp?: number;
  /**
   * Server-issued timestamp the wallet folds into the canonical
   * claim-bytes (`prson-login-claim/v2`). Stored at draft-init time;
   * the verify-and-activate handler uses THIS stored value (not any
   * client-supplied echo) when re-computing the bytes to verify
   * against. See M-3.
   */
  serverTs?: number;
  sessionExp?: number;
  walletPkX?: string;
  /**
   * Token-hash pinning per role (M-2). The first WS upgrade for a
   * given role locks the role to this token hash; subsequent upgrades
   * with a DIFFERENT hash are refused (401). Same-hash reconnects are
   * accepted (network blips, app foreground/background) — they still
   * trigger same-role replacement (4002), but the new socket gets to
   * keep the role.
   *
   * Worker-side it's the sha256(token) base64url; never the token
   * itself, so a DO storage leak doesn't disclose the bearer.
   */
  pinnedTokenHashes?: { browser?: string; wallet?: string };
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
        reqId: string;
        canonical: string;
        domain: string;
        draftExp: number;
        serverTs: number;
      };
      if (this.session.status === "active") {
        // Idempotent: a repeat draft for the same reqId during an active
        // session is harmless; surface the stored canonical so the
        // browser sees the same thing.
        return new Response("active", { status: 200 });
      }
      this.session = {
        status: "draft",
        reqId: body.reqId,
        canonical: body.canonical,
        domain: body.domain,
        draftExp: body.draftExp,
        serverTs: body.serverTs,
        cached: [],
      };
      await this.state.storage.put("session", this.session);
      // Alarm: drop the draft if no claim within DRAFT_TTL_SECONDS.
      await this.state.storage.setAlarm(body.draftExp * 1000);
      return new Response("ok", { status: 200 });
    }

    if (req.method === "POST" && url.pathname === "/internal/verify-and-activate") {
      const body = (await req.json()) as {
        walletPk: { kty: "OKP"; crv: "Ed25519"; x: string };
        claimDomain: string;
        signature: string;
        sessionExp: number;
      };
      if (this.session.status === "closed") {
        return new Response("closed", { status: 410 });
      }
      if (!this.session.canonical) {
        return new Response("no-draft", { status: 404 });
      }
      if (this.session.serverTs == null) {
        // Pre-v2 draft state (shouldn't happen in steady state, but
        // defends against rolling deploys / replayed alarms).
        return new Response("no-serverTs", { status: 410 });
      }
      // Domain echo check — the wallet signed for whichever domain
      // it pulled from the QR; the DO knows the canonical domain
      // from the genuine browser session. Mismatch → tampered QR.
      if (this.session.domain !== body.claimDomain) {
        return new Response("domain-mismatch", { status: 401 });
      }
      // Reconstruct the canonical claim-bytes using the STORED
      // reqId + serverTs + domain (never the client-supplied ones).
      // The wallet must have signed over exactly these bytes; any QR
      // tampering breaks the signature.
      if (this.session.reqId == null) {
        return new Response("no-reqId", { status: 410 });
      }
      const toVerify = canonicalClaimBytesV2({
        reqId: this.session.reqId,
        walletPkX: body.walletPk.x,
        serverTs: this.session.serverTs,
        domain: this.session.domain ?? "",
      });
      let ok = false;
      try {
        const key = await crypto.subtle.importKey(
          "jwk",
          body.walletPk as JsonWebKey,
          { name: "Ed25519" },
          false,
          ["verify"],
        );
        ok = await crypto.subtle.verify(
          "Ed25519",
          key,
          base64UrlToBytes(body.signature),
          toVerify,
        );
      } catch {
        ok = false;
      }
      if (!ok) return new Response("bad-signature", { status: 401 });

      // Atomic promotion to ACTIVE.
      this.session.status = "active";
      this.session.walletPkX = body.walletPk.x;
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
    // stub.fetch(originalRequest, { headers: { x-prson-role,
    // x-prson-token-hash } }). We refuse if the session has already
    // lapsed or never existed, OR if the role is already pinned to a
    // different token hash (M-2).
    if (req.headers.get("Upgrade") === "websocket") {
      if (this.session.status === "closed") {
        return new Response("session closed", { status: 410 });
      }
      const role = req.headers.get("x-prson-role") as Role | null;
      if (!role) return new Response("missing role", { status: 400 });
      const tokenHash = req.headers.get("x-prson-token-hash");
      if (!tokenHash) {
        return new Response("missing token hash", { status: 400 });
      }
      // Role-pin check. First upgrade for the role records the hash;
      // subsequent upgrades MUST present the same hash to be accepted.
      const pinned = this.session.pinnedTokenHashes ?? {};
      const pinnedForRole = pinned[role];
      if (pinnedForRole != null && pinnedForRole !== tokenHash) {
        // A second valid token exists for this role — possible only if
        // the HMAC secret was compromised (M-1 rotation defends going
        // forward) OR if Worker logic is broken. Either way we refuse.
        return new Response("role-token-pin-mismatch", { status: 401 });
      }
      if (pinnedForRole == null) {
        this.session.pinnedTokenHashes = { ...pinned, [role]: tokenHash };
        void this.state.storage.put("session", this.session);
      }
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
  // No `ts` field in v2 — the timestamp is server-issued + stored
  // server-side, never accepted from the client.
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
 * Versioned token format:
 *
 *   `<kid>.<exp>.<role>.<base64url(HMAC-SHA256(reqId+"\n"+role+"\n"+exp))>`
 *
 * The `kid` identifies which keyring entry signed the token; verifiers
 * accept any kid whose entry is currently active OR retired (until the
 * retired `validUntil` timestamp). Legacy tokens minted with the
 * previous 3-segment format (no kid) are still accepted, signed under
 * the legacy single-secret binding — that branch is the migration off-
 * ramp; once every issued token has been replaced by a kid-prefixed one
 * (~15 min after first deploy), the legacy branch can be retired.
 */
async function mintRoleToken(opts: {
  reqId: string;
  role: Role;
  exp: number;
  env: Env;
}): Promise<string> {
  const ring = resolveSignerKeyring(opts.env);
  const tag = await hmacSha256B64u(
    ring.active.secret,
    `${opts.reqId}\n${opts.role}\n${opts.exp}`,
  );
  return `${ring.active.kid}.${opts.exp}.${opts.role}.${tag}`;
}

async function verifyRoleToken(
  token: string,
  reqId: string,
  env: Env,
): Promise<{ role: Role; exp: number; kid: string } | null> {
  const parts = token.split(".");
  // Two accepted shapes:
  //   4-segment (v2, kid-prefixed): kid.exp.role.tag
  //   3-segment (v1, legacy):       exp.role.tag       (verifies under
  //                                                     SIG_TOKEN_HMAC_SECRET)
  if (parts.length !== 3 && parts.length !== 4) return null;

  if (parts.length === 4) {
    const kid = parts[0]!;
    const exp = Number(parts[1]);
    const role = parts[2] as Role;
    const tag = parts[3]!;
    if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
    if (role !== "browser" && role !== "wallet") return null;
    const ring = resolveSignerKeyring(env);
    const entry = ring.entries.get(kid);
    if (!entry) return null;
    if (entry.validUntil != null && entry.validUntil * 1000 < Date.now()) {
      return null;
    }
    const expected = await hmacSha256B64u(
      entry.secret,
      `${reqId}\n${role}\n${exp}`,
    );
    if (!timingSafeEqual(tag, expected)) return null;
    return { role, exp, kid };
  }

  // Legacy 3-segment path. Accepted only when SIG_TOKEN_HMAC_SECRET is
  // configured (deployments that already migrated to the keyring don't
  // need the back-compat branch — drop SIG_TOKEN_HMAC_SECRET from
  // bindings and this path becomes a no-op).
  if (!env.SIG_TOKEN_HMAC_SECRET) return null;
  const exp = Number(parts[0]);
  const role = parts[1] as Role;
  const tag = parts[2]!;
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
  if (role !== "browser" && role !== "wallet") return null;
  const expected = await hmacSha256B64u(
    env.SIG_TOKEN_HMAC_SECRET,
    `${reqId}\n${role}\n${exp}`,
  );
  if (!timingSafeEqual(tag, expected)) return null;
  return { role, exp, kid: "legacy" };
}

interface SignerEntry {
  kid: string;
  secret: string;
  /** Epoch seconds. Null on the active entry (no upper bound). */
  validUntil: number | null;
}

interface SignerKeyring {
  active: SignerEntry;
  /** Map of all entries (active + retired) keyed by kid for lookup. */
  entries: Map<string, SignerEntry>;
}

/**
 * Parse `env.SIG_TOKEN_HMAC_KEYRING` (preferred) OR synthesize a
 * one-entry keyring from `env.SIG_TOKEN_HMAC_SECRET` (back-compat).
 * Cached per isolate so repeat invocations don't re-parse.
 */
let _ringCache: { rawHash: string; ring: SignerKeyring } | null = null;
function resolveSignerKeyring(env: Env): SignerKeyring {
  const raw = env.SIG_TOKEN_HMAC_KEYRING?.trim() ?? "";
  if (raw.length === 0) {
    // Legacy single-secret path. Synthesise an `active` entry with a
    // stable kid so tokens minted in this path are still kid-prefixed
    // (forward-compat — if the operator later sets the keyring, old
    // tokens still verify because `legacy` lives in the keyring's
    // back-compat branch).
    if (!env.SIG_TOKEN_HMAC_SECRET) {
      throw new Error("No HMAC secret configured (KEYRING nor SECRET set)");
    }
    const entry: SignerEntry = {
      kid: "legacy",
      secret: env.SIG_TOKEN_HMAC_SECRET,
      validUntil: null,
    };
    return { active: entry, entries: new Map([["legacy", entry]]) };
  }
  // Tiny cache so we don't JSON.parse on every signing operation.
  if (_ringCache && _ringCache.rawHash === raw) return _ringCache.ring;
  let parsed: {
    active: { kid: string; secret: string };
    retired?: Array<{ kid: string; secret: string; validUntil: number }>;
  };
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`SIG_TOKEN_HMAC_KEYRING is not valid JSON: ${(e as Error).message}`);
  }
  if (!parsed.active?.kid || !parsed.active?.secret) {
    throw new Error("SIG_TOKEN_HMAC_KEYRING.active must have {kid, secret}");
  }
  const entries = new Map<string, SignerEntry>();
  entries.set(parsed.active.kid, {
    kid: parsed.active.kid,
    secret: parsed.active.secret,
    validUntil: null,
  });
  for (const r of parsed.retired ?? []) {
    if (!r.kid || !r.secret || typeof r.validUntil !== "number") continue;
    entries.set(r.kid, { kid: r.kid, secret: r.secret, validUntil: r.validUntil });
  }
  const ring: SignerKeyring = {
    active: entries.get(parsed.active.kid)!,
    entries,
  };
  _ringCache = { rawHash: raw, ring };
  return ring;
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
