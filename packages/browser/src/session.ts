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
import { boxToWallet, decryptEnvelope } from "./crypto.js";
import type { Transport } from "./transport.js";
import { verifyPresentation, type VerifyOptions } from "./verify.js";
import {
  RequestController,
  type LoginRequest,
  type LoginResponse,
  type RequestOptions,
} from "./requests.js";

export type { LoginRequest, LoginResponse, RequestOptions, InputType } from "./requests.js";

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
  /**
   * Claim added / updated. `newHash` is a hex-encoded SHA-256 of the
   * canonical-JSON encoding of the NEW value — the host can compare
   * against a precomputed `sha256(canonical(expected))` to confirm
   * what the new value is without ever seeing the value travel
   * through the event payload. The full value lives in
   * `session.claims[name]` for callers that need it.
   */
  | { type: "claim_added"; name: string; newHash: string }
  | { type: "claim_updated"; name: string; newHash: string }
  | { type: "claim_removed"; name: string }
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

  /**
   * Wallet's session X25519 public key. Captured from the first
   * inbound envelope's `walletSessionPk`. Null until then — calls
   * to `request()` before it lands resolve with
   * `{ ok: false, error: "no-active-session" }`.
   */
  private _walletSessionPk: string | null = null;

  /** Pairs outbound `request` envelopes with inbound `response`s. */
  private _requestController = new RequestController();

  /**
   * Per-`requestId` mouse-update subscribers. Populated by
   * [`bindMouse`] when it opens a `kind: "mouse"` request and torn
   * down when the controller disposes or the wallet's final
   * `response` arrives. Keys are RFC-4122 v4 UUIDs (the request id);
   * values get a stream of decoded `mouse` bodies.
   */
  private _mouseSubscribers: Map<string, (mouse: NonNullable<DecryptedEnvelope["mouse"]>) => void> = new Map();

  /**
   * Remote-navigation listener — installed by
   * [`enableRemoteNavigation`]. Receives every inbound `nav`,
   * `value`, and `logout` envelope. Only one listener at a time
   * (later registrations replace the prior). Null when remote-nav
   * is not active for this session.
   */
  private _remoteNavListener:
    | ((
        envelope:
          | { msg: "nav"; action: "prev" | "next" | "submit" }
          | { msg: "value"; value: string }
          | { msg: "logout" },
      ) => void)
    | null = null;

  /**
   * User's preferred UI language as a BCP-47 tag. Captured from the
   * initial `presentation` envelope's `preferredLanguage` field;
   * updated whenever a fresh envelope arrives with a new value.
   * Null until the first envelope lands. The host page reads this
   * to localise its own UI without an extra round-trip.
   */
  private _preferredLanguage: string | null = null;

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
    /**
     * The wallet's session X25519 public key from the initial
     * `presentation` envelope. Required to open the browser→wallet
     * request channel (`session.request(...)`). Optional only for
     * back-compat with older wallets that don't yet publish it.
     */
    walletSessionPk?: string;
    /**
     * Initial `preferredLanguage` value from the wallet's first
     * envelope. The session's own `_handleMessage` only sees
     * envelopes that arrive AFTER signIn() has consumed the
     * presentation, so the language tag on the first envelope is
     * otherwise lost — leaving `session.preferredLanguage` null
     * until a later renewal envelope. Seeded here so the value
     * is available immediately when the host inspects it after
     * `signIn()` resolves.
     */
    initialPreferredLanguage?: string;
  }) {
    this._cnf = opts.cnf;
    this._expiresAt = opts.credential.expiresAt;
    this._transport = opts.transport;
    this._ephKeys = opts.ephKeys;
    this._verifierContext = opts.verifierContext;
    this._claimsSnapshot = { ...(opts.initialClaims ?? {}) };
    this._walletSessionPk = opts.walletSessionPk ?? null;
    this._preferredLanguage = opts.initialPreferredLanguage ?? null;
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

  /** User's preferred UI language (BCP-47 tag) or null if the
   *  wallet hasn't published one yet. */
  get preferredLanguage(): string | null {
    return this._preferredLanguage;
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

  // ─── Request channel ─────────────────────────────────────────────

  /**
   * Send a [request] to the wallet and resolve with the wallet's
   * reply. The wallet shows a bottom drawer for the user to
   * approve / decline / pick a matching fragment or document; the
   * promise resolves when the user acts (or the [timeoutMs]
   * elapses, or the session closes).
   *
   * Common error codes:
   *   * `no-active-session` — request issued before the wallet has
   *      published its session pk (race against the initial
   *      `presentation` envelope) or after the session closed.
   *   * `declined` — user tapped Decline in the wallet drawer.
   *   * `not-present` — no matching fragment / document on the
   *      device AND the user declined to acquire one.
   *   * `queue-full` — wallet is sitting at the 5-in-flight cap and
   *      isn't accepting more requests. Try later.
   *   * `rate-limited` — wallet's 1-request-per-second throttle
   *      rejected this one.
   *   * `timeout` — the [timeoutMs] elapsed before the wallet
   *      replied. Defaults to 60 s.
   *   * `session-closed` — the session shut down with this request
   *      in flight.
   *
   * Wire grammar: outbound envelope shape is
   * `{ v, msg: "request", issuedAt, domain, requestId, kind, ...kindFields }`,
   * NaCl-boxed to the wallet's session pk. Reply is a matching
   * `{ msg: "response", requestId, result | error }`.
   */
  async request(req: LoginRequest, opts?: RequestOptions): Promise<LoginResponse> {
    return this._sendRequest(req, opts);
  }

  /**
   * Streaming variant of [request] for `kind: "mouse"`. Identical
   * to `request()` except [onFrame] is invoked for every
   * `mouse-update` envelope the wallet emits against the request's
   * UUID until the terminating `response` arrives. The returned
   * promise resolves with the final response (i.e. when the user
   * closes the wallet drawer). Used by [`bindMouse`].
   *
   * Separated from `request()` because the subscriber MUST be
   * attached against the requestId BEFORE the envelope is sent —
   * otherwise the first `mouse-update` frame can race ahead of the
   * subscription. `request()` doesn't expose its requestId, so we
   * provide this dedicated entry point rather than leak the id.
   */
  async requestMouse(
    req: Extract<LoginRequest, { kind: "mouse" }>,
    onFrame: (mouse: NonNullable<DecryptedEnvelope["mouse"]>) => void,
    opts?: RequestOptions,
  ): Promise<LoginResponse> {
    return this._sendRequest(req, opts, onFrame);
  }

  /**
   * Push the currently-focused input's metadata + value to the
   * wallet so the user can edit it on the phone. Pass `null` to
   * clear the wallet's focus mirror (blur, page change, etc.).
   *
   * Used by [`enableRemoteNavigation`]; not part of the documented
   * public API but exposed so the helper lives in a separate module
   * without reaching into private fields. NaCl-boxed to the wallet's
   * session pk on the way out.
   *
   * @internal
   */
  async _sendFocus(
    focus:
      | {
          name: string;
          label?: string;
          inputType?: string;
          value?: string;
          placeholder?: string;
          minLength?: number;
          maxLength?: number;
          min?: number;
          max?: number;
          pattern?: string;
          required?: boolean;
          options?: { value: string; label?: string }[];
        }
      | null,
  ): Promise<void> {
    if (this._closed) return;
    const recipientPk = this._walletSessionPk;
    if (!recipientPk) return;
    const payload: Record<string, unknown> = {
      v: "prson_vp_v1",
      msg: "focus",
      issuedAt: Math.floor(Date.now() / 1000),
      domain: this._verifierContext.expectedAudience.replace(/^https?:\/\//, ""),
      focus,
    };
    try {
      const boxed = boxToWallet(recipientPk, JSON.stringify(payload));
      this._transport.send(boxed);
    } catch {
      /* swallow — channel down */
    }
  }

  /**
   * Install the remote-navigation listener. Replaces any prior
   * listener — only one is active at a time. Returns an unsubscribe
   * handle. Used by [`enableRemoteNavigation`].
   *
   * @internal
   */
  _setRemoteNavListener(
    cb:
      | ((
          envelope:
            | { msg: "nav"; action: "prev" | "next" | "submit" }
            | { msg: "value"; value: string }
            | { msg: "logout" },
        ) => void)
      | null,
  ): Unsubscribe {
    this._remoteNavListener = cb;
    return () => {
      if (this._remoteNavListener === cb) this._remoteNavListener = null;
    };
  }

  private async _sendRequest(
    req: LoginRequest,
    opts?: RequestOptions,
    onMouseFrame?: (mouse: NonNullable<DecryptedEnvelope["mouse"]>) => void,
  ): Promise<LoginResponse> {
    if (this._closed) return { ok: false, error: "session-closed" };
    const recipientPk = this._walletSessionPk;
    if (!recipientPk) return { ok: false, error: "no-active-session" };

    const timeoutMs = opts?.timeoutMs ?? 60_000;
    const { requestId, promise } = this._requestController.enqueue(timeoutMs);

    // Attach the streaming subscriber BEFORE sending so the first
    // mouse-update frame can never race ahead of the subscription.
    if (onMouseFrame) this._mouseSubscribers.set(requestId, onMouseFrame);

    const envelope: Record<string, unknown> = {
      v: "prson_vp_v1",
      msg: "request",
      issuedAt: Math.floor(Date.now() / 1000),
      domain: this._verifierContext.expectedAudience.replace(/^https?:\/\//, ""),
      requestId,
      kind: req.kind,
    };
    // Per-kind body — flat keys for simplicity, matches the wallet's
    // existing wire-decoder pattern.
    switch (req.kind) {
      case "claim-value":
        envelope.name = req.name;
        if (req.reason) envelope.reason = req.reason;
        break;
      case "fragment-check":
        envelope.fragmentName = req.fragmentName;
        if (req.reason) envelope.reason = req.reason;
        break;
      case "document-presence":
        if (req.type) envelope.type = req.type;
        if (req.country) envelope.country = req.country;
        if (req.reason) envelope.reason = req.reason;
        break;
      case "document-sign":
        // Bytes get base64'd in the envelope; large docs should use
        // `uploadUrl` to keep the WebRTC message size down.
        if ("bytes" in req.document) {
          envelope.document = {
            bytes: u8ToB64(req.document.bytes),
          };
        } else {
          envelope.document = req.document;
        }
        if (req.visibleCue) envelope.visibleCue = req.visibleCue;
        if (req.reason) envelope.reason = req.reason;
        break;
      case "input":
        envelope.inputType = req.inputType;
        envelope.label = req.label;
        if (req.placeholder !== undefined) envelope.placeholder = req.placeholder;
        if (req.defaultValue !== undefined) envelope.defaultValue = req.defaultValue;
        if (req.minLength !== undefined) envelope.minLength = req.minLength;
        if (req.maxLength !== undefined) envelope.maxLength = req.maxLength;
        if (req.min !== undefined) envelope.min = req.min;
        if (req.max !== undefined) envelope.max = req.max;
        if (req.pattern !== undefined) envelope.pattern = req.pattern;
        if (req.required !== undefined) envelope.required = req.required;
        if (req.options !== undefined) envelope.options = req.options;
        if (req.reason) envelope.reason = req.reason;
        break;
      case "input-form":
        envelope.fields = req.fields;
        if (req.submitLabel !== undefined) envelope.submitLabel = req.submitLabel;
        if (req.reason) envelope.reason = req.reason;
        break;
      case "mouse":
        envelope.mode = req.mode;
        if (req.reason) envelope.reason = req.reason;
        break;
    }

    try {
      const boxed = boxToWallet(recipientPk, JSON.stringify(envelope));
      this._transport.send(boxed);
    } catch {
      // Network down, channel closed, encoding bug — surface as
      // session-closed; the timeout would also fire eventually.
      if (onMouseFrame) this._mouseSubscribers.delete(requestId);
      return { ok: false, error: "session-closed" };
    }
    return promise;
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
    // eslint-disable-next-line no-console
    console.info(
      `[@prson/login-sdk] arming expiry timer: ` +
        `expiresAt=${this._expiresAt} (${new Date(this._expiresAt).toISOString()}) ` +
        `now=${Date.now()} (${new Date().toISOString()}) ` +
        `delta_ms=${delta}`,
    );
    if (delta <= 0) {
      // `delta <= 0` means the credential is "expired" against the
      // browser clock. Three sub-cases — only the LAST should
      // actually tear the session down:
      //
      //   A. `expiresAt === 0` — the credential's JWS had no
      //      numeric `exp` and `verify.ts` defaulted to zero.
      //      Tearing down would fire the moment the user signs in,
      //      which is visibly wrong (wallet still thinks the
      //      session is valid). Skip the timer.
      //
      //   B. `expiresAt > 0` and within a 60 s window of "now" —
      //      almost certainly browser ↔ wallet/server clock skew or
      //      network latency between issuance and verify. Tearing
      //      down on this signal causes the "signed_in then
      //      signed_out a second later" UX bug. Skip the timer.
      //
      //   C. `expiresAt > 0` and meaningfully in the past — a real
      //      expired credential. Teardown.
      //
      // For A and B we leave the session open until the wallet (or
      // the host) closes it. The host can still read
      // `session.expiresAt` to make its own decision.
      const skewBudgetMs = 60_000;
      if (this._expiresAt <= 0 || -delta < skewBudgetMs) {
        // eslint-disable-next-line no-console
        console.warn(
          `[@prson/login-sdk] credential expiresAt ${
            this._expiresAt <= 0 ? "missing/zero" : `${(-delta / 1000).toFixed(1)}s in the past`
          } — leaving session open without a TTL timer.` +
            " Host should set its own deadline.",
        );
        return;
      }
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
    // Wallet may rotate its session pk on a renewal. We always read
    // the latest one from any decrypted inbound envelope so the
    // browser→wallet channel stays unblocked even after rotation.
    if (typeof envelope.walletSessionPk === "string") {
      this._walletSessionPk = envelope.walletSessionPk;
    }
    // Same treatment for the user's preferred language — the wallet
    // re-stamps this on every envelope so a mid-session locale
    // change propagates without an explicit event.
    if (typeof envelope.preferredLanguage === "string") {
      this._preferredLanguage = envelope.preferredLanguage;
    }

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
      case "response":
        // Wallet replied to an outbound `request`. Match by UUID
        // and resolve the matching promise. Late replies (after
        // timeout) silently no-op — the controller already
        // delivered the timeout error.
        this._requestController.resolve(envelope);
        // If the request was a streaming `mouse` request, the final
        // `response` also closes the stream — drop the subscriber so
        // the controller can be reused.
        if (envelope.requestId) this._mouseSubscribers.delete(envelope.requestId);
        return;
      case "mouse-update":
        // Wallet is streaming pointer events for a `kind: "mouse"`
        // request. Route by `requestId` to the bindMouse subscriber.
        // Unknown ids (subscriber already disposed) silently drop.
        if (envelope.requestId && envelope.mouse) {
          const sub = this._mouseSubscribers.get(envelope.requestId);
          if (sub) {
            try {
              sub(envelope.mouse);
            } catch {
              /* swallow — host bug shouldn't kill the stream */
            }
          }
        }
        return;
      case "nav":
      case "logout":
        // Remote-navigation commands from the wallet's persistent
        // banner. Without an installed listener (i.e. the host
        // didn't call `enableRemoteNavigation`), `nav` is silently
        // dropped and `logout` falls through to the default teardown
        // below — the user tapping logout MUST sign the session out
        // even if the host never wired the optional helper.
        if (this._remoteNavListener) {
          try {
            if (envelope.msg === "nav" && envelope.action) {
              this._remoteNavListener({ msg: "nav", action: envelope.action });
              return;
            }
            if (envelope.msg === "logout") {
              this._remoteNavListener({ msg: "logout" });
              // Logout also tears the session down — the helper may
              // have already done it, but tearing again is a no-op.
              this._teardown("user_revoked");
              return;
            }
          } catch {
            /* swallow */
          }
        }
        if (envelope.msg === "logout") this._teardown("user_revoked");
        return;
      case "value":
        // Wallet edited the value of the focused field. The remote-
        // nav helper is the only consumer; without it the edit is
        // silently dropped (the host page never asked for remote
        // input control). `value: null` is "no change" — we ignore.
        if (
          this._remoteNavListener &&
          typeof envelope.value === "string"
        ) {
          try {
            this._remoteNavListener({ msg: "value", value: envelope.value });
          } catch {
            /* swallow */
          }
        }
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
    // eslint-disable-next-line no-console
    console.info(
      `[@prson/login-sdk] _handleRenewal triggered with envelope.msg=${envelope.msg}`,
    );
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

    // Added + updated — emit name + canonical hash of the new
    // value (NOT the raw value). The host reads the actual value
    // via `session.claims[name]` when needed; the hash lets
    // callers do an `==`-style check against a precomputed digest
    // ("did verification_level become 5?") without ever letting
    // the raw value cross the event surface.
    for (const [name, newValue] of Object.entries(newClaims)) {
      if (!(name in oldClaims)) {
        this._dispatch({
          type: "claim_added",
          name,
          newHash: await canonicalSha256Hex(newValue),
        });
      } else if (!_deepEqual(oldClaims[name], newValue)) {
        this._dispatch({
          type: "claim_updated",
          name,
          newHash: await canonicalSha256Hex(newValue),
        });
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
    // Reject every in-flight request so callers awaiting
    // `session.request(...)` don't hang past the teardown.
    this._requestController.closeAll("session-closed");
    // Drop any open mouse-update subscribers — the wallet won't be
    // sending more frames, and `bindMouse` will clean up its
    // DOM-side state via the `signed_out` event.
    this._mouseSubscribers.clear();
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
 * `Uint8Array` → standard base64 (with `=` padding) for inclusion
 * inside a JSON envelope. Used by the request channel's
 * `document-sign` payload when the document arrives as raw bytes.
 */
function u8ToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

/**
 * Canonical-JSON encoder: stable key ordering at every nesting
 * depth, no whitespace, arrays preserve insertion order. Used as
 * the input to the SHA-256 that becomes `claim_added.newHash` /
 * `claim_updated.newHash`. Matches the wallet's
 * `canonicalStringify` byte-for-byte, so both sides hash to the
 * same digest — the host can precompute a known-value digest and
 * compare.
 */
function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      "{" +
      keys
        .map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(String(value));
}

/**
 * SHA-256 over `canonicalJson(value)` returned as 64-char lowercase
 * hex. Uses the browser-native WebCrypto API — no dependency. Async
 * because `crypto.subtle.digest` is async.
 */
async function canonicalSha256Hex(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let s = "";
  for (let i = 0; i < view.length; i++) {
    s += view[i]!.toString(16).padStart(2, "0");
  }
  return s;
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
