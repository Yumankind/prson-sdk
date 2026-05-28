/**
 * Typed HTTPS wrappers around the Cloudflare Worker's session API.
 *
 * The SDK does NOT depend on Firebase. The Worker is the single API
 * surface: anonymous /session/draft for the browser, wallet-signed
 * /session/claim for the wallet. See `../../infra/signaling-worker`
 * for the server impl and `../../ARCHITECTURE.md` for the spec.
 */
import { SIGNALING_BASE } from "./index.js";

/** The verifier-side request blob the SDK assembles + sends to /session/draft. */
export type VerifierRequest = {
  domain: string;
  nonce: string;
  browserPk: string;
  required: {
    minVerificationLevel?: 1 | 2 | 3 | 4 | 5 | 6;
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
