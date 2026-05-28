/**
 * PrsonLoginSession — the live-handle the SDK returns from signIn().
 * Owns the established WebRTC transport + ephemeral keys; surfaces
 * renewal events as the wallet pushes them; tears everything down
 * when the credential expires or the host calls close().
 */
import type { CnfJwk, SignInResult } from "./index.js";
import type { EphemeralKeys } from "./crypto.js";
import { decryptEnvelope } from "./crypto.js";
import type { Transport } from "./transport.js";
import { verifyPresentation, type VerifyOptions } from "./verify.js";

export type ExpiryReason =
  | "ttl_reached"
  | "wallet_signed_out"
  | "user_revoked"
  | "network_loss"
  | "credential_revoked";

export type Renewal = Pick<SignInResult, "sdJwtVc" | "claims" | "credential">;

export class PrsonLoginSession {
  private _expiresAt: number;
  private _cnf: { jwk: CnfJwk };
  private _renewedListeners: Array<(fresh: SignInResult) => void> = [];
  private _expiryListeners: Array<(reason: ExpiryReason) => void> = [];
  private _transport: Transport;
  private _ephKeys: EphemeralKeys;
  private _verifierContext: VerifierContext;
  private _expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private _closed = false;

  constructor(opts: {
    cnf: { jwk: CnfJwk };
    credential: { expiresAt: number };
    transport: Transport;
    ephKeys: EphemeralKeys;
    verifierContext: VerifierContext;
  }) {
    this._cnf = opts.cnf;
    this._expiresAt = opts.credential.expiresAt;
    this._transport = opts.transport;
    this._ephKeys = opts.ephKeys;
    this._verifierContext = opts.verifierContext;
    this._armExpiryTimer();
    this._transport.onMessage((raw) => void this._handleMessage(raw));
  }

  get expiresAt(): number { return this._expiresAt; }
  get cnf(): { jwk: CnfJwk } { return this._cnf; }

  onRenewed(cb: (fresh: SignInResult) => void): void {
    this._renewedListeners.push(cb);
  }

  onExpiry(cb: (reason: ExpiryReason) => void): void {
    this._expiryListeners.push(cb);
  }

  close(): void {
    this._teardown("user_revoked");
  }

  // ─── internals ───────────────────────────────────────────────────

  private _armExpiryTimer() {
    if (this._expiryTimer) clearTimeout(this._expiryTimer);
    const delta = this._expiresAt - Date.now();
    if (delta <= 0) {
      this._teardown("ttl_reached");
      return;
    }
    this._expiryTimer = setTimeout(() => this._teardown("ttl_reached"), delta);
  }

  private async _handleMessage(raw: string) {
    if (this._closed) return;
    let envelope;
    try {
      envelope = await decryptEnvelope(raw, this._ephKeys);
    } catch {
      // Garbage on the wire — ignore. The Worker may also fan out
      // peer-close signals here; those don't decrypt and that's fine.
      return;
    }
    if (envelope.msg === "revoke") {
      this._teardown("wallet_signed_out");
      return;
    }
    if (envelope.msg !== "presentation" && envelope.msg !== "renewal") return;

    // Renewal: re-verify against a fresh KB nonce. The wallet
    // generates its own monotonically-increasing nonce per renewal
    // and writes it into the KB-JWT; we accept any nonce within the
    // session as long as the rest of the proof verifies.
    const verifierOpts: VerifyOptions = {
      ...this._verifierContext,
      expectedNonce: extractKbNonce(envelope.presentation) ?? this._verifierContext.expectedNonceFactory(),
    };
    const verified = await verifyPresentation(envelope.presentation, verifierOpts);
    if (!verified.ok) return;
    if (verified.cnf.jwk.x !== this._cnf.jwk.x) return; // wallet swapped under us; ignore
    this._expiresAt = verified.credential.expiresAt;
    this._armExpiryTimer();
    const fresh: SignInResult = {
      sdJwtVc: envelope.presentation,
      claims: verified.claims,
      cnf: verified.cnf,
      credential: verified.credential,
      session: this,
    };
    for (const cb of this._renewedListeners) cb(fresh);
  }

  private _teardown(reason: ExpiryReason) {
    if (this._closed) return;
    this._closed = true;
    if (this._expiryTimer) clearTimeout(this._expiryTimer);
    try { this._transport.close(); } catch { /* */ }
    for (const cb of this._expiryListeners) cb(reason);
  }
}

type VerifierContext = Omit<VerifyOptions, "expectedNonce"> & {
  expectedNonceFactory: () => string;
};

/**
 * Best-effort nonce extraction from a KB-JWT. Used at renewal time so
 * we accept the wallet's fresh nonce without forcing a coordination
 * round-trip. The verifier still checks aud + sd_hash + Ed25519
 * signature — nonce skew only relaxes anti-replay across the session.
 */
function extractKbNonce(presentation: string): string | undefined {
  const parts = presentation.split("~");
  const last = parts[parts.length - 1];
  if (!last || !last.includes(".")) return undefined;
  const [, kbP] = last.split(".");
  if (!kbP) return undefined;
  try {
    const pad = (4 - (kbP.length % 4)) % 4;
    const std = (kbP + "=".repeat(pad)).replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(atob(std)) as { nonce?: string };
    return decoded.nonce;
  } catch {
    return undefined;
  }
}
