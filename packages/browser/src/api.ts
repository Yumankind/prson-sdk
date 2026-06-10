/**
 * Typed HTTPS wrappers around the Cloudflare Worker's session API.
 *
 * The SDK does NOT depend on Firebase. The Worker is the single API
 * surface: anonymous /session/draft for the browser, wallet-signed
 * /session/claim for the wallet. See `../../../../cloudflare-workers/signaling-worker`
 * for the server impl and `../../ARCHITECTURE.md` for the spec.
 */
import { SIGNALING_BASE } from "./index.js";

/** The verifier-side request blob the SDK assembles + sends to /session/draft. */
export type VerifierRequest = {
  domain: string;
  nonce: string;
  browserPk: string;
  required: {
    /** 0 = pseudonymous (unverified identity) accepted; omitted ⇒ 1. */
    minVerificationLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    requiredClaims?: string[];
    predicates?: string[];
    identityType?: "personal" | "organization";
  };
  ttlMaxMinutes: number;
};

export type DraftResult = {
  reqId: string;
  /** Bearer used on the WS upgrade `Sec-WebSocket-Protocol` header. */
  draftToken: string;
  /** wss URL the SDK opens to join the Durable Object as the browser peer. */
  signalingWss: string;
  /** Epoch s — caller has until this moment for a wallet to claim. */
  draftExpiresAt: number;
  /**
   * **Server-issued timestamp** (epoch seconds, M-3 / v2). The Worker
   * stamped it at draft creation and stored it in the DO. The wallet
   * MUST echo this value verbatim in its `prson-login-claim/v2`
   * signature — the Worker rebuilds the canonical bytes using its
   * stored copy, so any tamper breaks the signature. The SDK threads
   * it through the QR (`t=` param).
   */
  serverTs: number;
  /**
   * Cloudflare TURN credentials for the BROWSER side of the data
   * channel. The wallet gets its own set from `/session/claim`. With
   * a relay candidate on both peers, ICE succeeds across every NAT
   * variant — including localhost + Chrome's mDNS-obfuscated host
   * candidates that iOS WebRTC can't resolve. Wire grammar matches
   * `RTCIceServer`: `{ urls, username, credential }`. Older Workers
   * that pre-date this field omit it; the SDK falls back to STUN
   * only in that case.
   */
  turn?: {
    urls: string | string[];
    username: string;
    credential: string;
    expiresAt?: number;
  };
};

/**
 * POST /session/draft on the Cloudflare Worker. Anonymous + IP rate-
 * limited at 30 drafts/IP/min (no TURN allocated yet — the Worker
 * waits for a wallet to claim before issuing any relay capacity).
 */
export async function createDraft(
  request: VerifierRequest,
  opts: { signalingBase?: string; fetchImpl?: typeof fetch } = {},
): Promise<DraftResult> {
  const base = opts.signalingBase ?? SIGNALING_BASE;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(`${base}/session/draft`, {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request }),
  });
  if (!res.ok) {
    const text = await safeText(res);
    if (res.status === 429) {
      throw new Error("Too many login sessions from this network — please retry shortly.");
    }
    throw new Error(`createDraft failed: HTTP ${res.status} ${text || res.statusText}`);
  }
  return (await res.json()) as DraftResult;
}

async function safeText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return ""; }
}
