/**
 * @prson/login-cli — sign in with Prson from terminal programs.
 *
 * Reuses the **sessionless wallet-action transport** (`/request/v1`
 * universal links + delivery pinning) end-to-end: no signaling session,
 * no WebRTC, no new server surface. The flow is the device-code shape:
 *
 *   1. The CLI builds a `/request/v1` link bound to YOUR service's
 *      domain and renders it as a QR code in the terminal (and/or a
 *      short code your backend redirects from).
 *   2. The user scans it with their phone — the Prson wallet opens its
 *      consent screen showing your domain (same anti-phishing renderer
 *      as web login).
 *   3. On approve, the wallet POSTs the presentation + signed
 *      predicates to your backend's `responseUrl` (HTTPS, host pinned
 *      to your domain — the wallet refuses anything else).
 *   4. The CLI polls your backend until the response keyed by `nonce`
 *      arrives. Your backend verifies it with `@prson/login-verifier`
 *      exactly like a web sign-in.
 *
 * The trust model is identical to the audited wallet-action links:
 * the user approves a domain they can read, and delivery is pinned to
 * that domain. The CLI never touches credentials directly — they land
 * at your verified HTTPS endpoint, and the CLI gets a session token
 * (or whatever your backend mints) out of band.
 */

import { createHash, randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What the wallet should prove. Mirrors `required` in /request/v1. */
export interface CliLoginRequired {
  /** Floor for the verified-human VC (0–6). */
  minVerificationLevel?: number;
  /** SD-JWT-VC claim names to disclose (e.g. "verified_human_at"). */
  claims?: readonly string[];
  /** Fragment-catalog predicate ids (e.g. "age_gte_18", "email_domain_academic"). */
  predicates?: readonly string[];
  /** Domain-scoped unique-human id (sybil-resistant account key). */
  uniqueHumanId?: boolean;
}

export interface CliLoginOptions {
  /**
   * Your service's registrable domain (e.g. "example.com"). Shown to
   * the user on the wallet consent screen; the wallet pins delivery
   * to it. Lowercase LDH host with at least one dot, no port.
   */
  domain: string;
  /**
   * HTTPS endpoint on `domain` that receives the wallet's POST
   * (`{ v:1, action:"request", nonce, domain, presentation?, facts?,
   * uniqueHumanId? }`). Host must equal `domain`, port 443.
   */
  responseUrl: string;
  /** Optional app-to-app bounce after delivery (https, host == domain). */
  returnUrl?: string;
  /** What to ask for. At least one field must be set. */
  required: CliLoginRequired;
  /** Wallet link base. Default: https://app.prson.net */
  walletBase?: string;
  /** Override the nonce (>= 16 chars). Default: 32 random bytes, base64url. */
  nonce?: string;
}

export interface CliLoginRequest {
  /** Universal link that opens the Prson wallet — encode this as a QR. */
  url: string;
  /** Request nonce, echoed verbatim in the wallet's response POST. */
  nonce: string;
  /**
   * Short human-friendly code derived from the nonce (Crockford
   * base32, "XXXX-XXXX"). Use it to label the pending login in your
   * backend, and optionally as a typeable alternative to the QR: serve
   * `https://<domain>/cli/<userCode>` as a 302 to `url` and the user
   * can open that on their phone instead of scanning.
   */
  userCode: string;
  /** The decoded request payload (what the wallet will parse). */
  req: Record<string, unknown>;
}

export interface PollOptions {
  /** Delay between attempts. Default 2000 ms. */
  intervalMs?: number;
  /** Give up after this long. Default 300000 ms (5 min) — matches the user walking away. */
  timeoutMs?: number;
  /** Abort from outside (Ctrl-C handlers etc.). */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

const DEFAULT_WALLET_BASE = "https://app.prson.net";

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** Mirrors the wallet's `_validDomain`: lowercase LDH, contains a dot. */
function validDomain(raw: string): string {
  const d = raw.toLowerCase();
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(d) || !d.includes(".")) {
    throw new Error(`invalid domain '${raw}': lowercase LDH host with a dot, no port`);
  }
  return d;
}

/** Mirrors the wallet's `_pinnedHttpsUrl`: https, host == domain, port 443. */
function pinnedHttpsUrl(raw: string, domain: string, field: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`${field} is not a URL: ${raw}`);
  }
  if (u.protocol !== "https:") throw new Error(`${field} must be https`);
  if (u.port && u.port !== "443") throw new Error(`${field} must use port 443`);
  if (u.hostname.toLowerCase() !== domain) {
    throw new Error(
      `${field} host '${u.hostname}' must equal domain '${domain}' — ` +
        `the wallet refuses unpinned delivery`
    );
  }
  return raw;
}

/**
 * Short pairing code from a nonce: first 8 chars of Crockford-base32
 * SHA-256, grouped XXXX-XXXX. Collision-safe enough to label pending
 * logins (your backend still keys on the full nonce).
 */
export function userCodeFromNonce(nonce: string): string {
  const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford
  const digest = createHash("sha256").update(nonce, "utf8").digest();
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += ALPHABET[(digest[i] as number) % 32];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Build a delivery-pinned /request/v1 wallet link for a CLI login.
 * Throws on any input the wallet would refuse, so misconfiguration
 * fails in your terminal rather than silently on the user's phone.
 */
export function createFactsRequest(opts: CliLoginOptions): CliLoginRequest {
  const domain = validDomain(opts.domain);
  const responseUrl = pinnedHttpsUrl(opts.responseUrl, domain, "responseUrl");
  const returnUrl = opts.returnUrl
    ? pinnedHttpsUrl(opts.returnUrl, domain, "returnUrl")
    : undefined;

  const r = opts.required ?? {};
  const required: Record<string, unknown> = {};
  if (typeof r.minVerificationLevel === "number") {
    if (r.minVerificationLevel < 0 || r.minVerificationLevel > 6 || !Number.isInteger(r.minVerificationLevel)) {
      throw new Error("required.minVerificationLevel must be an integer 0–6");
    }
    required.minVerificationLevel = r.minVerificationLevel;
  }
  if (r.claims?.length) required.claims = [...r.claims];
  if (r.predicates?.length) required.predicates = [...r.predicates];
  if (r.uniqueHumanId) required.uniqueHumanId = true;
  if (Object.keys(required).length === 0) {
    throw new Error(
      "required must ask for something (minVerificationLevel, claims, predicates or uniqueHumanId) — the wallet refuses empty requests"
    );
  }

  const nonce = opts.nonce ?? b64url(randomBytes(32));
  if (nonce.length < 16) throw new Error("nonce must be at least 16 chars");

  const req: Record<string, unknown> = {
    v: 1,
    domain,
    nonce,
    responseUrl,
    ...(returnUrl ? { returnUrl } : {}),
    required,
  };

  const base = (opts.walletBase ?? DEFAULT_WALLET_BASE).replace(/\/$/, "");
  const blob = b64url(Buffer.from(JSON.stringify(req), "utf8"));
  return {
    url: `${base}/request/v1?req=${blob}`,
    nonce,
    userCode: userCodeFromNonce(nonce),
    req,
  };
}

// ---------------------------------------------------------------------------
// Terminal QR rendering
// ---------------------------------------------------------------------------

/**
 * Render a wallet link as an ANSI QR string for the terminal.
 * `small: true` (default) uses half-height blocks — fits standard
 * 80×24 terminals for /request/v1-sized payloads.
 */
export async function renderQr(url: string, opts: { small?: boolean } = {}): Promise<string> {
  const { default: qrcode } = await import("qrcode-terminal");
  return new Promise((resolve) => {
    qrcode.generate(url, { small: opts.small !== false }, (out: string) => resolve(out));
  });
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

/**
 * Poll your backend until the wallet's response has landed.
 *
 * `check` asks your backend about the pending login (keyed by the
 * request nonce) and returns the result when complete, or
 * null/undefined while still pending. Whatever it returns is whatever
 * your backend mints after verifying the wallet POST with
 * `@prson/login-verifier` — typically a session token, never the raw
 * presentation.
 *
 * Throws on timeout or abort.
 */
export async function pollForResponse<T>(
  check: () => Promise<T | null | undefined>,
  opts: PollOptions = {}
): Promise<T> {
  const intervalMs = opts.intervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (opts.signal?.aborted) throw new Error("cli-login poll aborted");
    const result = await check();
    if (result !== null && result !== undefined) return result;
    if (Date.now() + intervalMs > deadline) {
      throw new Error(`cli-login poll timed out after ${timeoutMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// ---------------------------------------------------------------------------
// Convenience one-shot
// ---------------------------------------------------------------------------

export interface CliLoginHandle extends CliLoginRequest {
  /** ANSI QR of `url`, ready to console.log. */
  qr: string;
  /** Poll your backend for the verified outcome (see pollForResponse). */
  wait<T>(check: () => Promise<T | null | undefined>, opts?: PollOptions): Promise<T>;
}

/**
 * Build the request AND pre-render the QR in one call:
 *
 *   const login = await startCliLogin({ domain, responseUrl, required: { predicates: ["age_gte_18"] } });
 *   console.log(login.qr);
 *   console.log(`...or open https://${domain}/cli/${login.userCode} on your phone`);
 *   const session = await login.wait(() => checkBackend(login.nonce));
 */
export async function startCliLogin(opts: CliLoginOptions): Promise<CliLoginHandle> {
  const request = createFactsRequest(opts);
  const qr = await renderQr(request.url);
  return {
    ...request,
    qr,
    wait: (check, pollOpts) => pollForResponse(check, pollOpts),
  };
}
