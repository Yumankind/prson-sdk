/**
 * @prson/login-sdk — browser runtime.
 *
 * Top-level entry point: `PrsonLogin.signIn(opts)` orchestrates the
 * whole flow. The pieces underneath are:
 *
 *   ┌── ./session.ts        — PrsonLoginSession (state machine + events)
 *   ├── ./signaling.ts      — WebSocket to the Cloudflare Worker
 *   ├── ./transport.ts      — RTCPeerConnection + data channel
 *   ├── ./crypto.ts         — X25519 ephemeral keypair + NaCl box decrypt
 *   ├── ./verify.ts         — verify issuer JWS + KB-JWT in the browser
 *   ├── ./qr.ts             — render the prson://login/v1?... QR
 *   └── ./api.ts            — typed createLoginSession + resolveLoginSession
 *
 * See ../../README.md for integration. See ../../../ARCHITECTURE.md
 * for the wire spec.
 */
import {
  PrsonLoginSession,
  type ExpiryReason,
  type Renewal,
} from "./session.js";
import { createDraft } from "./api.js";
import { generateEphemeralKeypair, decryptEnvelope } from "./crypto.js";
import { connectSignaling } from "./signaling.js";
import { establishTransport } from "./transport.js";
import { renderLoginQr, createModalQrMount } from "./qr.js";
import { verifyPresentation } from "./verify.js";

// ─────────────────────────────────────────────────────────────────────
// Public types — these mirror the contract in this folder's README.
// ─────────────────────────────────────────────────────────────────────

export type SignInOptions = {
  domain?: string;
  required?: {
    minVerificationLevel?: 1 | 2 | 3 | 4 | 5 | 6;
    requiredClaims?: string[];
    predicates?: string[];
    identityType?: "personal" | "organization";
  };
  /**
   * If `true`, the SDK ALSO accepts an **anonymous-wallet** credential
   * — a self-signed JWT issued by the wallet's per-domain Ed25519 key,
   * with no notary involvement. The wallet's login drawer surfaces an
   * "Sign in anonymously" option to the user. The credential carries
   * only `cnf.jwk` + `aud` + `nonce` + `iat` + `exp` (no
   * `verified_human`, no document fields, no predicates). The
   * verifier treats `cnf.jwk.x` as the stable per-user identifier on
   * this domain.
   *
   * If a verified credential is presented when `allowAnonymous: true`
   * AND `required.*` constraints are set, the verified credential is
   * still checked against those constraints — the relaxation only
   * applies to the anonymous fallback. Default false.
   */
  allowAnonymous?: boolean;

  /**
   * If `true`, the wallet generates a **fresh random Ed25519 keypair**
   * for this single login instead of the deterministic per-domain
   * HKDF derivation. The credential's `cnf.jwk` is therefore
   * **different on every sign-in attempt** — there is no stable per-
   * user id, and a future mnemonic compromise cannot retroactively
   * link the user across sessions on this site.
   *
   * Trade-off: `cnf.jwk.x` is no longer a per-user identifier on this
   * domain. Sites that key sessions off `cnf.jwk.x` must derive a
   * usable account id by some other means (e.g. a user-chosen
   * username on first visit). Best fit for read-only / single-use
   * flows where re-identification on return is irrelevant.
   *
   * Combine with `allowAnonymous: true` for a fully unlinkable
   * anonymous flow. Default false.
   *
   * Closes [SECURITY-AUDIT §M-5](../../SECURITY-AUDIT-2026-05-28.md).
   */
  ephemeralIdentity?: boolean;

  ttlMinutes?: number;
  ui?: {
    mountQrInto?: string | HTMLElement;
    theme?: "light" | "dark" | "auto";
  };
  defer?: boolean;

  /**
   * QR-mode only: opt in to **remote navigation**. The wallet shows a
   * persistent banner that opens a bottom drawer with Prev / Next /
   * Submit (Enter) / Logout / (optional) Mouse buttons. The host
   * page's currently-focused input is mirrored on the phone so the
   * user can edit / clear / replace the value with the phone
   * keyboard, and edits stream back into the DOM in real time.
   *
   * Auto-wires when the SDK detects a QR-mode sign-in (the QR encodes
   * `remoteNavigation: true` for the wallet to honour). Same-device
   * universal-link flows ignore the flag — the banner would be
   * redundant when the wallet is on the same device as the page.
   *
   * Pair with [`enableRemoteNavigation`] to install the DOM focus
   * listeners that mirror the active input. Default false.
   */
  remoteNavigation?: boolean;
};

export type CnfJwk = {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
};

export type SignInResult = {
  sdJwtVc: string;
  claims: Record<string, unknown>;
  cnf: { jwk: CnfJwk };
  credential: {
    vct: string;
    iss: string;
    kid: string;
    expiresAt: number;
  };
  session: PrsonLoginSession;
};

export type { ExpiryReason } from "./session.js";

// Constants exported for verifier-side consumers + diagnostics.
export const PROTOCOL_VERSION = "prson_vp_v1";
export const TRUSTED_ISSUER = "did:web:app.prson.net";
export const KNOWN_VCTS = [
  "https://app.prson.net/credentials/verified-human/v1",
  "https://app.prson.net/credentials/verified-identity/v1",
] as const;
/** Self-signed wallet credential — accepted only when the SDK is
 *  invoked with `allowAnonymous: true`. Carries only `cnf.jwk` + the
 *  KB-JWT fields; no notary signature. */
export const ANONYMOUS_WALLET_VCT =
  "https://app.prson.net/credentials/anonymous-wallet/v1";
export const DEFAULT_TTL_MINUTES = 10;
export const MAX_TTL_MINUTES = 15;
/** Cloudflare Worker single-API-surface base URL. Override in dev with
 *  `PrsonLogin.signIn({ ... signalingBase: "https://localhost:8787" })`
 *  via your own wrapper if you've stood up a local Worker. */
export const SIGNALING_BASE = "https://signaling.prson.net";

// ─────────────────────────────────────────────────────────────────────
// Concurrency guard — one in-flight sign-in at a time
// ─────────────────────────────────────────────────────────────────────
//
// A user who clicks "Sign in" twice in quick succession (because the
// first click felt slow, or the QR scrolled out of view) would
// otherwise spawn two parallel sign-in flows, each holding its own
// draftToken / WS / RTCPeerConnection / QR card. The second sign-in's
// QR would stack on top of the first; both wallets would try to
// claim; the verifier might commit the wrong identity.
//
// Semantics:
//   * Only the PHASE BEFORE signIn() resolves is treated as
//     "in-flight". Once signIn() has resolved into a live session,
//     that session is no longer in-flight; a fresh signIn() does
//     NOT terminate the live session it just supersedes (the host
//     page can keep the prior session handle if it needs to).
//   * A second signIn() while a first is in-flight calls the first
//     one's abort(), which runs the registered teardowns in LIFO
//     order (latest resource first). The first signIn() then sees
//     the abort signal on its next `await` and throws
//     `LoginAbortedError`.
//
// Implementation: module-scoped current-inflight slot + per-call
// disposer chain that the displacement awaits.

/**
 * Thrown by `PrsonLogin.signIn()` when a NEWER `signIn()` call
 * displaces the current in-flight one. Host pages typically ignore
 * this — the user's second click is the cancellation signal — but
 * the typed error lets you distinguish it from real failures.
 */
export class LoginAbortedError extends Error {
  constructor(message = "sign-in aborted by a newer signIn() call") {
    super(message);
    this.name = "LoginAbortedError";
  }
}

interface InflightSignIn {
  /** True once a newer signIn() has called `abort()`. */
  aborted: boolean;
  /**
   * Run the registered teardowns in LIFO order and mark
   * `aborted = true`. Resolves after every teardown has settled.
   */
  abort(): Promise<void>;
  /** Push a teardown thunk; runs once on `abort()` or normal exit. */
  pushTeardown(t: () => void | Promise<void>): void;
}

let _inflight: InflightSignIn | null = null;

function makeInflight(): InflightSignIn {
  const teardowns: Array<() => void | Promise<void>> = [];
  const self: InflightSignIn = {
    aborted: false,
    pushTeardown(t) {
      teardowns.push(t);
    },
    async abort() {
      if (self.aborted) return;
      self.aborted = true;
      // LIFO so we close the most-recently-acquired resource first
      // — typically the transport / RTCPeerConnection — and unwind
      // backwards through signaling, QR, draft state.
      while (teardowns.length) {
        const t = teardowns.pop();
        try {
          await t?.();
        } catch {
          /* swallow — best-effort cleanup */
        }
      }
    },
  };
  return self;
}

// ─────────────────────────────────────────────────────────────────────
// Public façade
// ─────────────────────────────────────────────────────────────────────

export class PrsonLogin {
  /**
   * Drive a full sign-in. The promise resolves once the wallet has
   * delivered a verified SD-JWT-VC; the returned session lives until
   * one of the four `ExpiryReason` triggers.
   */
  static async signIn(opts: SignInOptions = {}): Promise<SignInResult> {
    // ─── concurrency guard ──────────────────────────────────────
    // Tear down any prior in-flight sign-in BEFORE we mint a fresh
    // draft. Awaited so the prior's QR / signaling are gone before
    // the new one mounts — gives the user immediate visual
    // confirmation that the second click cancelled the first. If
    // there's no prior, `prior?.abort()` is a cheap no-op.
    const prior = _inflight;
    if (prior) await prior.abort();
    const me = makeInflight();
    _inflight = me;

    /** Throw `LoginAbortedError` if a newer signIn() has displaced us. */
    const checkAborted = () => {
      if (me.aborted) throw new LoginAbortedError();
    };

    try {
    const domain = opts.domain ?? window.location.origin.replace(/^https?:\/\//, "");
    const ttlMaxMinutes = Math.min(
      Math.max(opts.ttlMinutes ?? DEFAULT_TTL_MINUTES, 1),
      MAX_TTL_MINUTES,
    );

    // 1. Generate the ephemeral X25519 keypair the wallet will encrypt
    //    its envelope to. Stays in memory only — never written to
    //    storage, never crosses any network boundary.
    const ephKeys = await generateEphemeralKeypair();
    checkAborted();

    // 2. Build the verifier request blob. The reqId is content-bound
    //    so the wallet sees the same canonical bytes the Worker stored
    //    (anti-tamper, see SECURITY.md §3).
    const nonce = b64u(crypto.getRandomValues(new Uint8Array(32)));
    const request = {
      domain,
      nonce,
      browserPk: ephKeys.publicKeyB64u,
      required: opts.required ?? {},
      // Carried into the wallet's drawer so an "Anonymous" option is
      // offered. The SDK side enforces acceptance below at verify time;
      // the wallet enforces drawer UX based on this flag.
      allowAnonymous: opts.allowAnonymous === true,
      // If set, instructs the wallet to mint a fresh random Ed25519
      // keypair for this single sign-in (no deterministic per-domain
      // HKDF). Closes M-5; see SignInOptions.ephemeralIdentity.
      ephemeralIdentity: opts.ephemeralIdentity === true,
      // QR-mode remote navigation — wallet surfaces Prev / Next /
      // Submit / Logout / Mouse on a persistent banner. See
      // SignInOptions.remoteNavigation + bind.ts:enableRemoteNavigation.
      remoteNavigation: opts.remoteNavigation === true,
      ttlMaxMinutes,
    };

    // 3. Register the draft directly with the Cloudflare Worker.
    //    Anonymous + IP rate-limited. NO TURN allocation, NO Firebase
    //    in the path — the Worker is the single API surface and waits
    //    for the wallet to claim before allocating real capacity.
    const draft = await createDraft(request);
    checkAborted();

    // 4. Render the QR encoding the deep-link URL the wallet scans /
    //    the mobile browser taps.
    const qrUrl = buildDeepLinkUrl({
      reqId: draft.reqId,
      browserPk: ephKeys.publicKeyB64u,
      nonce,
      domain,
      request,
      serverTs: draft.serverTs,
    });
    const explicitMount = resolveMount(opts.ui?.mountQrInto);
    let qrHandle: ReturnType<typeof renderLoginQr> | null = null;
    let modalHandle: { mount: HTMLElement; dispose: () => void } | null = null;
    if (explicitMount) {
      // Host gave us a mount — render inline (no scrim, host owns
      // surrounding chrome).
      qrHandle = renderLoginQr(qrUrl, explicitMount, opts.ui?.theme ?? "auto");
    } else {
      // No mount supplied → default to a centred modal with a dark
      // scrim. Esc / click-outside aborts the in-flight signIn so
      // `await signIn(...)` rejects with `LoginAbortedError`. This
      // gives the partner a zero-config sign-in experience.
      modalHandle = createModalQrMount({
        onDismiss: () => {
          // `me.abort()` is async but `onDismiss` is a click /
          // keyboard handler — fire-and-forget. The in-flight
          // teardown chain runs the QR + scrim dispose so the
          // overlay drops immediately. The next `await` in the
          // signIn flow then throws `LoginAbortedError`.
          void me.abort();
        },
      });
      qrHandle = renderLoginQr(
        qrUrl,
        modalHandle.mount,
        opts.ui?.theme ?? "auto",
      );
    }
    // Register QR teardown FIRST so an abort during signaling/connect
    // immediately removes the on-screen artefact even before the
    // network resources close.
    if (qrHandle) me.pushTeardown(() => qrHandle!.dispose());
    if (modalHandle) me.pushTeardown(() => modalHandle!.dispose());

    // 5. Open the WS to the Cloudflare Worker. The DO is in DRAFT until
    //    a wallet's /session/claim flips it to ACTIVE; we'll still
    //    receive cached SDP/ICE from the wallet at that point.
    const signaling = await connectSignaling({
      url: draft.signalingWss,
      role: "browser",
      sigToken: draft.draftToken,
    });
    me.pushTeardown(() => signaling.close());
    checkAborted();

    // 6. Bring up the RTCPeerConnection + data channel. The browser
    //    side uses STUN only — relay capacity is allocated only after
    //    the wallet signs /session/claim, and the wallet is the peer
    //    that allocates the TURN relay. The browser reaches the
    //    wallet's relayed candidates as a remote address, no client-
    //    side TURN credentials needed.
    const transport = await establishTransport({
      stunOnly: true,
      signaling,
      role: "browser",
    });
    // From here on, `transport` owns the signaling channel — its
    // close() will close the WS too. Replace the prior signaling
    // teardown so we don't double-close.
    me.pushTeardown(() => transport.close());
    checkAborted();

    // 7. Wait for the wallet's encrypted envelope on the data channel.
    //    The wallet emits exactly one `prson_vp_v1 / msg=presentation`
    //    on initial sign-in; renewals come later via the session handle.
    const first = await transport.awaitFirstMessage();
    checkAborted();
    const envelope = await decryptEnvelope(first, ephKeys);
    if (envelope.v !== PROTOCOL_VERSION || envelope.msg !== "presentation") {
      throw new Error(`Unexpected first message: ${envelope.v}/${envelope.msg}`);
    }
    // After the post-ROADMAP-§1 envelope grammar made `presentation`
    // optional (so it can be absent on `display-update` /
    // `credential-revoked`), the narrowed `msg === "presentation"`
    // branch still has it as `string | undefined` to TypeScript.
    // Defensive runtime check + local rebind for type narrowing.
    const presentationStr = envelope.presentation;
    if (!presentationStr) {
      throw new Error("Initial presentation envelope had no presentation field");
    }

    // 8. Verify the presentation cryptographically before we hand it
    //    to the host application. The five rules in SECURITY.md §7
    //    are enforced here. When allowAnonymous is set, we also accept
    //    the self-signed anonymous-wallet VCT (different verification
    //    path: cnf.jwk == issuer, no notary signature to check).
    const acceptedVcts = opts.allowAnonymous
      ? [...KNOWN_VCTS, ANONYMOUS_WALLET_VCT]
      : [...KNOWN_VCTS];
    const verified = await verifyPresentation(presentationStr, {
      expectedAudience: `https://${domain}`,
      expectedNonce: nonce,
      acceptedVcts,
      trustedIssuer: TRUSTED_ISSUER,
    });
    if (!verified.ok) {
      throw new Error(`Presentation rejected: ${verified.reason}`);
    }

    // 9. Tear down the QR now that the sign-in is complete. The
    //    transport stays open for renewals; the session handle owns
    //    it from here on. We DON'T fire `transport.close()` — that
    //    teardown stays registered until the `finally` block clears
    //    the inflight slot, which happens AFTER this point but
    //    BEFORE the session uses the transport (so an abort racing
    //    a successful sign-in still wins until we resolve).
    //
    // Dispose order: QR card FIRST (removes card from DOM), then
    // the modal scrim (removes the dark-overlay div). If we did the
    // scrim first the card would briefly orphan in document.body
    // before the next paint.
    qrHandle?.dispose();
    modalHandle?.dispose();

    // The host needs both the SignInResult (returned synchronously
    // below) AND a `signed_in` event on the typed event stream (so
    // `onAny` listeners get a uniform lifecycle log). We build the
    // result first, hand it to the session as the initial-signed-in
    // payload (the session fires `signed_in` via microtask), and
    // return the same object.
    const result: SignInResult = {
      sdJwtVc: presentationStr,
      claims: verified.claims,
      cnf: verified.cnf,
      credential: verified.credential,
      // session is filled in below — temporary placeholder cast
      // avoids a circular-self-reference in the literal.
      session: undefined as unknown as PrsonLoginSession,
    };

    const session = new PrsonLoginSession({
      cnf: verified.cnf,
      credential: verified.credential,
      transport,
      ephKeys,
      verifierContext: {
        expectedAudience: `https://${domain}`,
        expectedNonceFactory: () => nonce, // renewals carry a fresh nonce; see session.ts
        acceptedVcts: [...KNOWN_VCTS],
        trustedIssuer: TRUSTED_ISSUER,
      },
      // Cache the verified claims so the session can diff them
      // against future `claim-update` envelopes — see ROADMAP §1.
      initialClaims: verified.claims,
      // Fire `signed_in` on the typed event stream. Microtask-
      // deferred inside the constructor, so listeners attached
      // synchronously after this `signIn()` resolves still
      // receive it.
      initialSignedInResult: result,
      // Forward `walletSessionPk` + `preferredLanguage` from the
      // FIRST envelope (which `signIn()` consumed before the session
      // existed) so they're available immediately on the session
      // handle. Without this seed the session would have
      // `walletSessionPk: null` (breaking the request channel) and
      // `preferredLanguage: null` (host can't localise on first
      // paint) until a subsequent envelope arrives.
      walletSessionPk: envelope.walletSessionPk,
      initialPreferredLanguage: envelope.preferredLanguage,
    });
    result.session = session;

    return result;
    } finally {
      // Release the slot ONLY if we still own it. If a newer signIn()
      // displaced us mid-flight, `_inflight` already points at
      // someone else; we mustn't clobber their entry. The displacing
      // signIn() already called our `abort()`, so the teardowns ran.
      if (_inflight === me) _inflight = null;
    }
  }

  /**
   * Rebind to a session that was previously established for the same
   * holder pk. Phase 2 placeholder — the SDK has no cross-page-load
   * state today; callers should redirect through `signIn` on each
   * page load (the cookie-on-the-server is the source of truth).
   */
  static async restore(_opts: {
    cnfJwk: CnfJwk;
    onExpiry?: (reason: ExpiryReason) => void;
  }): Promise<PrsonLoginSession | null> {
    return null;
  }
}

// Re-export for verifier-only consumers + custom UIs.
export { PrsonLoginSession };
export type { Renewal };

// Request channel — types + DOM-binding helpers. `bindInput` /
// `bindForm` are the kiosk-companion entry points; they synthesise
// a `session.request(...)` call from a DOM element and write the
// wallet's reply back into the page.
export type {
  LoginRequest,
  LoginResponse,
  RequestOptions,
  InputType,
  InputOption,
  InputFormField,
} from "./requests.js";
export {
  bindInput,
  bindForm,
  bindMouse,
  enableRemoteNavigation,
  type BindController,
  type BindMouseOptions,
  type RemoteNavController,
  type RemoteNavOptions,
} from "./bind.js";

// ─────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────

function b64u(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function resolveMount(into: string | HTMLElement | undefined): HTMLElement | null {
  if (!into) return null;
  if (typeof into === "string") return document.querySelector(into);
  return into;
}

/**
 * Build the deep-link URL the QR encodes. We emit the **universal-link
 * form** (`https://app.prson.net/login/v1?…`) — see
 * [SECURITY-AUDIT-2026-05-28.md §C-2](../../SECURITY-AUDIT-2026-05-28.md).
 *
 * Custom URI schemes (`prson://…`) have no cryptographic app-binding;
 * any installed app can register the same scheme and intercept the
 * tap. Universal Links (iOS) + App Links (Android) are bound to our
 * domain via `apple-app-site-association` + `assetlinks.json`, which
 * are signed against the wallet's signing-cert hash + our TLS cert.
 * A malicious app cannot register a competing handler.
 *
 * The wallet's `LoginDeepLink.tryParse` already accepts both forms,
 * so this change is one-sided.
 */
function buildDeepLinkUrl(args: {
  reqId: string;
  browserPk: string;
  nonce: string;
  domain: string;
  request: object;
  serverTs: number;
}): string {
  const params = new URLSearchParams({
    s: args.reqId,
    p: args.browserPk,
    n: args.nonce,
    d: args.domain,
    req: b64u(new TextEncoder().encode(JSON.stringify(args.request))),
    // M-3 / v2: the server-issued timestamp the wallet must fold into
    // its claim signature. The Worker uses its own stored copy at
    // verify time; tampering this in the QR breaks the signature.
    t: String(args.serverTs),
  });
  return `https://app.prson.net/login/v1?${params.toString()}`;
}
