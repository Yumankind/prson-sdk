/**
 * PrsonLoginSession — the live handle the SDK returns from
 * `signIn()`. Owns the established WebRTC transport + ephemeral
 * keys; dispatches a typed event stream as the wallet pushes
 * post-sign-in updates; tears everything down when the credential
 * expires or the host calls `close()`.
 *
 * Event taxonomy (see [ROADMAP §1](../../ROADMAP.md)):
 *
 *   Identity lifecycle:
 *     signed_in            — fires once, right after `signIn()`
 *                            resolves (via a microtask so listeners
 *                            attached synchronously after the await
 *                            still receive it).
 *     signed_out           — terminal; fires once with an
 *                            ExpiryReason.
 *     renewed              — wallet pushed a fresh VC + KB-JWT.
 *
 *   Claim updates (require a re-verified SD-JWT-VC in the same
 *   envelope):
 *     claim_added          — a claim name appeared that wasn't in
 *                            the prior snapshot.
 *     claim_removed        — a prior claim name is no longer
 *                            present.
 *     claim_updated        — same name, different value.
 *
 *   Display hints (no crypto re-verify; the host should treat the
 *   payload as advisory and ignore it for any privileged decision):
 *     display_name_changed
 *     avatar_changed
 *
 *   Compliance:
 *     credential_revoked   — followed by signed_out with reason
 *                            "credential_revoked".
 *
 * Wire grammar lives in `crypto.ts:DecryptedEnvelope`.
 */
import type { CnfJwk, SignInResult } from "./index.js";
import type { DecryptedEnvelope, EphemeralKeys } from "./crypto.js";
import { decryptEnvelope } from "./crypto.js";
import type { Transport } from "./transport.js";
import { verifyPresentation, type VerifyOptions } from "./verify.js";

export type ExpiryReason =
  | "ttl_reached"
  | "wallet_signed_out"
  | "user_revoked"
  | "network_loss"
  | "credential_revoked";

export type CredentialRevokedReason =
  | "alias_transferred"
  | "user_revoked"
  | "key_compromised";

/** Convenience alias kept for callers that consumed the old shape. */
export type Renewal = Pick<SignInResult, "sdJwtVc" | "claims" | "credential">;

/**
 * Discriminated union of every lifecycle event the SDK emits during
 * a live session. Each variant carries exactly the fields a
 * subscriber needs — no shared base envelope, so `e.type` is the
 * only discriminator and the TS compiler narrows the rest.
 *
 * The `signed_in` event also rides this union for uniform
 * subscription, even though `signIn()` already returns the result
 * synchronously. Useful for `onAny` listeners that want a single
 * log line per lifecycle transition.
 *
 * **Privacy policy: claim events never carry raw values.**
 * `claim_added` / `claim_updated` / `claim_removed` deliver only
 * the changed claim **name**. The actual value lives in
 * `session.claims` (the verified snapshot the SDK keeps in sync
 * with the latest SD-JWT-VC) and is read on-demand by the host.
 *
 * Why: `onAny` is the natural attachment point for telemetry
 * (analytics, error reporters, ML feature pipes, …). Any of those
 * trivially capture entire event objects. Putting `value` into the
 * event payload would silently leak raw identity data — name,
 * birthdate, verification level — through every such pipe without
 * the host owner noticing. Name-only events let telemetry log
 * **that** a claim changed without ever seeing **what** it changed
 * to. The host reads `session.claims[name]` when (and only when)
 * it needs the value, and is free to scrub that read site
 * independently of the event surface.
 *
 * The exceptions are the explicitly-public display fields
 * (`display_name_changed`, `avatar_changed`) — those carry their
 * values directly because they're meant to drive UI without an
 * extra read step.
 */
export type LoginEvent =
  | { type: "signed_in"; result: SignInResult }
  | { type: "signed_out"; reason: ExpiryReason }
  | { type: "renewed"; result: SignInResult }
  | { type: "claim_added"; name: string }
  | { type: "claim_removed"; name: string }
  | { type: "claim_updated"; name: string }
  | { type: "display_name_changed"; displayName: string | null }
  | { type: "avatar_changed"; avatar: { url: string; hash: string } | null }
  | { type: "credential_revoked"; reason: CredentialRevokedReason };

export type LoginEventType = LoginEvent["type"];

/** Function returned by `on()` / `onAny()` to remove the listener. */
export type Unsubscribe = () => void;

export class PrsonLoginSession {
  private _expiresAt: number;
  private _cnf: { jwk: CnfJwk };
  private _claimsSnapshot: Record<string, unknown>;
  private _transport: Transport;
  private _ephKeys: EphemeralKeys;
  private _verifierContext: VerifierContext;
  private _expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private _closed = false;

  /** Per-type listener map. */
  private _listeners: Map<LoginEventType, Set<(e: LoginEvent) => void>> =
    new Map();
  /** "Fire on every event" subscribers — for logging / telemetry. */
  private _anyListeners: Set<(e: LoginEvent) => void> = new Set();

  constructor(opts: {
    cnf: { jwk: CnfJwk };
    credential: { expiresAt: number };
    transport: Transport;
    ephKeys: EphemeralKeys;
    verifierContext: VerifierContext;
    /**
     * The verified-claim map from the initial sign-in. Cached so
     * `claim-update` events can compute a real diff (and so
     * `claim_added` / `claim_updated` carry old + new values). Optional
     * for back-compat; if absent the first `claim-update` treats
     * every claim as `claim_added`, which is the safe direction.
     */
    initialClaims?: Record<string, unknown>;
    /**
     * The `SignInResult` to deliver as the payload of the
     * `signed_in` event fired via microtask. Optional — pass to
     * enable `signed_in` dispatch; omit to leave the event silent.
     */
    initialSignedInResult?: SignInResult;
  }) {
    this._cnf = opts.cnf;
    this._expiresAt = opts.credential.expiresAt;
    this._transport = opts.transport;
    this._ephKeys = opts.ephKeys;
    this._verifierContext = opts.verifierContext;
    this._claimsSnapshot = { ...(opts.initialClaims ?? {}) };
    this._armExpiryTimer();
    this._transport.onMessage((raw) => void this._handleMessage(raw));

    // Fire `signed_in` via microtask so listeners attached
    // synchronously after `await signIn()` still receive it.
    // Without the microtask the event would race against the
    // caller's first `on()` registration.
    if (opts.initialSignedInResult) {
      const result = opts.initialSignedInResult;
      queueMicrotask(() => this._dispatch({ type: "signed_in", result }));
    }
  }

  // ─── Public getters ──────────────────────────────────────────────

  get expiresAt(): number {
    return this._expiresAt;
  }
  get cnf(): { jwk: CnfJwk } {
    return this._cnf;
  }
  /** Snapshot of the most recent verified claims (since last renew / update). */
  get claims(): Readonly<Record<string, unknown>> {
    return this._claimsSnapshot;
  }

  // ─── Subscription API ────────────────────────────────────────────

  /**
   * Subscribe to a single event type. The callback is invoked with
   * the typed event variant (TS narrows on the `type` discriminant).
   * Returns an unsubscribe handle.
   *
   *   const off = session.on("claim_updated", (e) => {
   *     if (e.name === "verification_level") refreshBadge(e.newValue);
   *   });
   *   // later:
   *   off();
   */
  on<T extends LoginEventType>(
    type: T,
    cb: (event: Extract<LoginEvent, { type: T }>) => void,
  ): Unsubscribe {
    let set = this._listeners.get(type);
    if (!set) {
      set = new Set();
      this._listeners.set(type, set);
    }
    const wrapped = cb as unknown as (e: LoginEvent) => void;
    set.add(wrapped);
    return () => set!.delete(wrapped);
  }

  /** Subscribe to every event. Returns an unsubscribe handle. */
  onAny(cb: (event: LoginEvent) => void): Unsubscribe {
    this._anyListeners.add(cb);
    return () => this._anyListeners.delete(cb);
  }

  // ─── Back-compat shims ───────────────────────────────────────────
  //
  // The original SDK exposed `onRenewed(cb)` and `onExpiry(cb)`.
  // We keep them as thin wrappers around the typed `on()` so
  // existing host pages compile without changes. New code should
  // prefer `on()` / `onAny()`.

  /** @deprecated Use `on("renewed", e => cb(e.result))` instead. */
  onRenewed(cb: (fresh: SignInResult) => void): Unsubscribe {
    return this.on("renewed", (e) => cb(e.result));
  }

  /** @deprecated Use `on("signed_out", e => cb(e.reason))` instead. */
  onExpiry(cb: (reason: ExpiryReason) => void): Unsubscribe {
    return this.on("signed_out", (e) => cb(e.reason));
  }

  close(): void {
    this._teardown("user_revoked");
  }

  // ─── internals ───────────────────────────────────────────────────

  /**
   * Fire a single event to per-type listeners + onAny subscribers.
   * Listener errors are swallowed so one buggy host listener can't
   * break the rest of the dispatch (or close the session).
   */
  private _dispatch(event: LoginEvent): void {
    const set = this._listeners.get(event.type);
    if (set) {
      for (const cb of set) {
        try {
          cb(event);
        } catch {
          /* swallow — host bug shouldn't bring down the session */
        }
      }
    }
    for (const cb of this._anyListeners) {
      try {
        cb(event);
      } catch {
        /* swallow */
      }
    }
  }

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
    let envelope: DecryptedEnvelope;
    try {
      envelope = await decryptEnvelope(raw, this._ephKeys);
    } catch {
      // Garbage on the wire — ignore. The Worker may also fan out
      // peer-close signals here; those don't decrypt and that's fine.
      return;
    }
    await this._dispatchDecryptedForTest(envelope);
  }

  /**
   * Pure dispatch entry-point — takes an already-decrypted envelope
   * and routes it through the same per-message handlers
   * `_handleMessage` does after decryption. Public-but-prefixed so
   * unit tests can exercise the dispatch contract without
   * constructing real NaCl-boxed ciphertext.
   *
   * NOT part of the documented public API; treat as @internal.
   */
  async _dispatchDecryptedForTest(envelope: DecryptedEnvelope): Promise<void> {
    if (this._closed) return;
    switch (envelope.msg) {
      case "revoke":
        this._teardown("wallet_signed_out");
        return;
      case "presentation":
      case "renewal":
        await this._handleRenewal(envelope);
        return;
      case "claim-update":
        await this._handleClaimUpdate(envelope);
        return;
      case "display-update":
        this._handleDisplayUpdate(envelope);
        return;
      case "credential-revoked":
        this._handleCredentialRevoked(envelope);
        return;
      default:
        // Forward-compatible: unknown msg types are ignored, not
        // errors. A future wallet build can ship new events that
        // older SDK builds simply don't surface.
        return;
    }
  }

  private async _handleRenewal(envelope: DecryptedEnvelope) {
    if (!envelope.presentation) return;
    // Renewal: re-verify against a fresh KB nonce. The wallet
    // generates its own monotonically-increasing nonce per renewal
    // and writes it into the KB-JWT; we accept any nonce within the
    // session as long as the rest of the proof verifies.
    const verifierOpts: VerifyOptions = {
      ...this._verifierContext,
      expectedNonce:
        extractKbNonce(envelope.presentation) ??
        this._verifierContext.expectedNonceFactory(),
    };
    const verified = await verifyPresentation(
      envelope.presentation,
      verifierOpts,
    );
    if (!verified.ok) return;
    if (verified.cnf.jwk.x !== this._cnf.jwk.x) return; // wallet swapped under us; ignore
    this._expiresAt = verified.credential.expiresAt;
    this._claimsSnapshot = { ...verified.claims };
    this._armExpiryTimer();
    const fresh: SignInResult = {
      sdJwtVc: envelope.presentation,
      claims: verified.claims,
      cnf: verified.cnf,
      credential: verified.credential,
      session: this,
    };
    this._dispatch({ type: "renewed", result: fresh });
  }

  /**
   * Verify the embedded presentation, then diff its claims against
   * the cached snapshot and emit name-only per-claim events. The
   * actual claim values land in `this._claimsSnapshot` (accessible
   * via `session.claims`) but **never** in the event payloads —
   * see the privacy note on the [LoginEvent] type.
   *
   * Re-verifies against the same audience + accepted-VCT set as the
   * initial sign-in. A `claim-update` whose presentation fails
   * verification is dropped silently — fail-closed. Same for a
   * cnf-mismatch (the wallet swapped per-domain key under us).
   *
   * The wire-level `envelope.delta` is intentionally ignored — we
   * recompute the diff from the verified SD-JWT so a malicious
   * wallet can't lie about which claim changed. The wallet should
   * not include values in `envelope.delta` at all (the wire
   * grammar in `crypto.ts` documents this as name-only); we'd
   * ignore them even if it did.
   */
  private async _handleClaimUpdate(envelope: DecryptedEnvelope) {
    if (!envelope.presentation) return;
    const verifierOpts: VerifyOptions = {
      ...this._verifierContext,
      expectedNonce:
        extractKbNonce(envelope.presentation) ??
        this._verifierContext.expectedNonceFactory(),
    };
    const verified = await verifyPresentation(
      envelope.presentation,
      verifierOpts,
    );
    if (!verified.ok) return;
    if (verified.cnf.jwk.x !== this._cnf.jwk.x) return;

    const oldClaims = this._claimsSnapshot;
    const newClaims = verified.claims;
    this._claimsSnapshot = { ...newClaims };

    // Added + updated — emit name only. Host reads the value via
    // `session.claims[name]` when needed; that read site is the
    // explicit, auditable point where claim values cross from the
    // SDK into host code.
    for (const [name, newValue] of Object.entries(newClaims)) {
      if (!(name in oldClaims)) {
        this._dispatch({ type: "claim_added", name });
      } else if (!_deepEqual(oldClaims[name], newValue)) {
        this._dispatch({ type: "claim_updated", name });
      }
    }
    // Removed
    for (const name of Object.keys(oldClaims)) {
      if (!(name in newClaims)) {
        this._dispatch({ type: "claim_removed", name });
      }
    }
  }

  /**
   * Display-only update. Fires `display_name_changed` and/or
   * `avatar_changed` based on which fields the envelope carries.
   * NOT cryptographically verified — partner sites should treat
   * the payload as advisory (refresh the cosmetic UI) and not
   * grant any privileged access on the basis of these values.
   */
  private _handleDisplayUpdate(envelope: DecryptedEnvelope) {
    if (envelope.displayName !== undefined) {
      this._dispatch({
        type: "display_name_changed",
        displayName: envelope.displayName,
      });
    }
    if (envelope.avatar !== undefined) {
      this._dispatch({ type: "avatar_changed", avatar: envelope.avatar });
    }
  }

  /**
   * Credential-revoked. Fires `credential_revoked` with the
   * wallet-supplied reason, then tears the session down with
   * `signed_out / reason="credential_revoked"`. Both events land
   * before the transport closes.
   */
  private _handleCredentialRevoked(envelope: DecryptedEnvelope) {
    const reason: CredentialRevokedReason = envelope.reason ?? "user_revoked";
    this._dispatch({ type: "credential_revoked", reason });
    this._teardown("credential_revoked");
  }

  private _teardown(reason: ExpiryReason) {
    if (this._closed) return;
    this._closed = true;
    if (this._expiryTimer) clearTimeout(this._expiryTimer);
    try {
      this._transport.close();
    } catch {
      /* */
    }
    this._dispatch({ type: "signed_out", reason });
    // Clear listener sets after dispatch so a host that calls
    // `session.on(...)` after teardown doesn't accumulate forever.
    this._listeners.clear();
    this._anyListeners.clear();
  }
}

type VerifierContext = Omit<VerifyOptions, "expectedNonce"> & {
  expectedNonceFactory: () => string;
};

/**
 * Best-effort nonce extraction from a KB-JWT. Used at renewal /
 * update time so we accept the wallet's fresh nonce without forcing
 * a coordination round-trip. The verifier still checks aud +
 * sd_hash + Ed25519 signature — nonce skew only relaxes anti-replay
 * across the session.
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

/**
 * Structural equality for claim values. The verifier emits plain
 * JSON shapes (strings, numbers, booleans, arrays of those, objects
 * of those) so a value-equal comparison via JSON round-trip is
 * correct and ~25 ns for the sizes we see in practice. Avoids
 * pulling in a deep-equal dep for one call site.
 */
function _deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a === null || b === null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
