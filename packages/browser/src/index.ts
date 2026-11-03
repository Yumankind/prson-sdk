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
import {
  renderLoginQr,
  createModalQrMount,
  type LoginQrContext,
  type LoginQrHandle,
} from "./qr.js";
import type { DraftResult } from "./api.js";
import { verifyPresentation } from "./verify.js";
import { notifyHandleFrom } from "./notify.js";

// ─────────────────────────────────────────────────────────────────────
// Public types — these mirror the contract in this folder's README.
// ─────────────────────────────────────────────────────────────────────

export type SignInOptions = {
  domain?: string;

  /**
   * A one-time value your BACKEND made for this sign-in (at least 16 random
   * bytes, base64url: 22-128 characters of `A-Z a-z 0-9 - _`). Store it
   * server-side, then verify the presentation there with
   * `verifyPresentation(presentation, { expectedNonce, expectedAudience })`
   * and delete it, so a captured presentation can't be replayed to your
   * backend. Omitted: the SDK makes one in the browser, which only protects
   * the in-browser check — not enough for a backend that trusts the result.
   *
   * May also be a function returning one (sync or async). The SDK then
   * calls it once per code it shows, so a refreshed code (after expiry or
   * an error) gets a fresh backend nonce without your page calling
   * `signIn()` again. `SignInResult.nonce` says which one the presentation
   * is bound to.
   */
  nonce?: string | (() => string | Promise<string>);

  /**
   * Which Prson backend environment to sign in against. `"dev"` points
   * the flow at the dev signaling Worker (`signaling-dev.prson.net`);
   * omit (or `"production"`) for the live environment. For a custom /
   * local Worker, set `signalingBase` instead (it takes precedence).
   * Default `"production"`.
   */
  environment?: "production" | "dev";

  /**
   * Explicit signaling Worker base URL — overrides `environment`. Use
   * for a local Worker (`https://localhost:8787`) or any non-standard
   * deployment. The Worker returns the matching WebSocket URL in its
   * draft response, so this single value steers the whole flow.
   */
  signalingBase?: string;

  required?: {
    /**
     * Minimum identity verification level (0–6). Omitted ⇒ 1.
     *
     * `0` opts into **pseudonymous identity sign-in**: the wallet may
     * present an UNVERIFIED identity, and the minted credential
     * honestly claims `verified_human: false` / `verification_level: 0`.
     * You still get the stable per-domain `sub` (cnf.jwk continuity) —
     * what you give up is any assurance a real, unique human is behind
     * it. Distinct from `allowAnonymous`, which is identity-less: a
     * level-0 identity sign-in carries the user's chosen identity and
     * survives across sessions; anonymous carries only a key.
     */
    minVerificationLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    requiredClaims?: string[];
    predicates?: string[];
    identityType?: "personal" | "organization";
    /**
     * Require a **domain-scoped unique-human id**: a notary-signed
     * pairwise identifier anchored to the user's verified government
     * document. Proves "one unique, document-verified human at YOUR
     * domain" (sybil resistance) without any cross-site correlation
     * handle. The wallet only offers document-backed identities
     * (level ≥ 4) when this is set; the result carries
     * `uniqueHumanId` for SERVER-SIDE verification.
     */
    uniqueHumanId?: boolean;
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

  /**
   * Sponsorship: pay for premium verifications your users need.
   *
   * If your `required.predicates` include facts that need a PAID
   * verification the user may not have yet (e.g. `phone_verified` —
   * SMS costs credits), create a **sponsorship grant** from your
   * company wallet (Prson app → `createSponsorshipGrant`) and put its
   * id here. The user's wallet then routes those verification costs
   * to your grant instead of the user.
   *
   * Safe to expose in page source: the grantId authorises nothing by
   * itself. Every redemption is validated server-side against the
   * STORED grant — bound to YOUR domain, capped per user (default
   * once), capped in total budget, expiring, and instantly revocable.
   */
  sponsorship?: { grantId: string };

  /**
   * **App-to-app return leg** (same-device native flows). An HTTPS URL
   * on YOUR login domain that the wallet opens after the credential
   * has been delivered — typically your Universal Link / Android App
   * Link, so the OS bounces the user straight back into your native
   * app (only the app your domain vouches for via AASA /
   * assetlinks.json receives it).
   *
   * Constraints (enforced both here and in the wallet):
   *   - `https://` only — custom schemes are refused (any installed
   *     app could claim a custom scheme; app links are domain-proven).
   *   - The URL's host MUST equal the login domain exactly.
   *
   * Only set this for same-device flows (your site opened inside a
   * Custom Tab / SFSafariViewController from your app). In cross-device
   * QR flows the wallet is on a different phone — it would open your
   * site there, which is harmless but pointless.
   */
  returnUrl?: string;

  ttlMinutes?: number;
  ui?: {
    /**
     * Render the code inline in this element instead of the SDK's own
     * dialog. The dialog is the default and the recommended experience.
     */
    mountQrInto?: string | HTMLElement;
    /** `"auto"` (default) follows `prefers-color-scheme`. The code itself is always dark on white. */
    theme?: "light" | "dark" | "auto";
    /** Where "Don't have Prson? Get it" points. Default https://app.prson.net/. */
    getAppUrl?: string;
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

  /**
   * **Mouse control pre-granted at sign-in.** When true, the wallet's
   * persistent banner drawer enables the Touchpad / Magic wand
   * buttons from the moment the session lands, so the user can
   * start driving the cursor without the host ever issuing a
   * `kind: "mouse"` request.
   *
   * The capability **persists** for the session lifetime — closing
   * the controller doesn't revoke it; the user can re-open it from
   * the drawer at any time. The host still calls [`bindMouse`] to
   * mount the on-page cursor; when this flag is set, that call
   * installs an *ambient* mouse-update subscriber so wallet-
   * initiated streams (which carry no `requestId` matched to a
   * pending `request()`) land correctly. Existing `requestMouse`
   * round-trips still work in parallel.
   *
   * The wallet shows a chip in the sign-in drawer so the user
   * sees mouse control will be active before they approve.
   *
   * Default false.
   */
  mouseControl?: boolean;

  /**
   * **Ask to send notifications.** The wallet's sign-in sheet shows an
   * unticked "Let {site} send you notifications" row; nothing is sent
   * unless the person ticks it. When they do, `SignInResult.notifications`
   * carries a handle for this person at your domain: random, so it can't
   * be linked to the same person's handle on any other site. Send it to
   * your backend with the presentation and call
   * `POST https://api.prson.net/v1/notify { handle, title, body, url? }`
   * with an API key that has `notify:write`, for an app whose registered
   * domains include this one. Plain text only (title up to 60
   * characters, body up to 180), `url` only on this sign-in domain itself
   * (the app asks the person before opening it), about 3
   * a day per person. A 410 means the person turned you off: forget the
   * handle. Default false.
   */
  notifications?: boolean;
};

export type CnfJwk = {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
};

export type SignInResult = {
  sdJwtVc: string;
  /** The nonce the presentation is bound to (yours when you passed `nonce`). */
  nonce: string;
  claims: Record<string, unknown>;
  cnf: { jwk: CnfJwk };
  credential: {
    vct: string;
    iss: string;
    kid: string;
    expiresAt: number;
  };
  /**
   * Present when the host set `required.uniqueHumanId: true`: a
   * notary-signed, domain-scoped uniqueness credential. OPAQUE
   * pass-through — verify it SERVER-SIDE with
   * `@prson/login-verifier`'s `verifyUniqueHumanId({...},
   * { expectedAudience: "your.host" })`, then use
   * `envelope.uniqueIdHash` as the sybil-resistant account key.
   * Stable for this human at your domain; uncorrelatable anywhere else.
   */
  uniqueHumanId?: {
    envelope: Record<string, unknown>;
    signature: string;
    kid: string;
  } | null;
  /**
   * Present when you set `notifications: true` and the person ticked "Let
   * {site} send you notifications": the handle your backend sends with
   * (see SignInOptions.notifications). null when they didn't.
   */
  notifications?: { handle: string } | null;
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
// Testing pass: 2-minute sessions surface expiry / renewal bugs
// quickly. Production target is 10 / 15. Keep these in sync with
// `SESSION_TTL_SECONDS` in `cloudflare-workers/signaling-worker/src/index.ts`.
export const DEFAULT_TTL_MINUTES = 2;
export const MAX_TTL_MINUTES = 2;
/** Cloudflare Worker single-API-surface base URL (production). */
export const SIGNALING_BASE = "https://signaling.prson.net";

/** Dev environment Worker base. Selected via `signIn({ environment: "dev" })`,
 *  or override either env with an explicit `signalingBase` (e.g. a local
 *  Worker at `https://localhost:8787`). */
export const SIGNALING_BASE_DEV = "https://signaling-dev.prson.net";

/** Map an `environment` shorthand to its Worker base URL. */
export function resolveSignalingBase(opts: {
  environment?: "production" | "dev";
  signalingBase?: string;
}): string {
  if (opts.signalingBase) return opts.signalingBase;
  return opts.environment === "dev" ? SIGNALING_BASE_DEV : SIGNALING_BASE;
}

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
  abort(message?: string): Promise<void>;
  /** Push a teardown thunk; runs once on `abort()` or normal exit. */
  pushTeardown(t: () => void | Promise<void>): void;
  /**
   * Rejects with `LoginAbortedError` the moment `abort()` is called. The
   * flow races its waits against it, so a closed dialog or a newer
   * `signIn()` settles this one at once instead of leaving it waiting
   * for a wallet that will never come.
   */
  whenAborted: Promise<never>;
}

let _inflight: InflightSignIn | null = null;

function makeInflight(): InflightSignIn {
  const teardowns: Array<() => void | Promise<void>> = [];
  let rejectAborted: (e: Error) => void = () => {};
  const whenAborted = new Promise<never>((_, reject) => {
    rejectAborted = reject;
  });
  whenAborted.catch(() => {
    /* only an error for whoever races it */
  });
  const self: InflightSignIn = {
    aborted: false,
    whenAborted,
    pushTeardown(t) {
      teardowns.push(t);
    },
    async abort(message?: string) {
      if (self.aborted) return;
      self.aborted = true;
      rejectAborted(new LoginAbortedError(message));
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
   *
   * Without `ui.mountQrInto` the SDK shows its own dialog and handles
   * everything in it: an expired code or a failure offers a fresh code
   * (a new draft, and a new nonce when `nonce` is a function) while this
   * promise keeps waiting; closing the dialog rejects with
   * `LoginAbortedError` (or with the error on screen, if one was shown).
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

    try {
      const domain = opts.domain ?? window.location.origin.replace(/^https?:\/\//, "");
      const theme = opts.ui?.theme ?? "auto";
      const titleId = `prson-login-title-${b64u(crypto.getRandomValues(new Uint8Array(6)))}`;
      const explicitMount = resolveMount(opts.ui?.mountQrInto);

      // No mount supplied → the SDK's own dialog, opened when the first
      // code is ready (no empty scrim while the draft is made). Esc /
      // click-outside / its close button abort the in-flight signIn so
      // `await signIn(...)` rejects with `LoginAbortedError`. Zero-config
      // for the partner.
      const dialog: { current: { mount: HTMLElement; dispose: () => void } | null } = { current: null };
      const getMount = (): HTMLElement => {
        if (explicitMount) return explicitMount;
        if (!dialog.current) {
          const m = createModalQrMount({ titleId, onDismiss: () => void me.abort("sign-in closed") });
          dialog.current = m;
          me.pushTeardown(() => m.dispose());
        }
        return dialog.current.mount;
      };

      // One attempt per code shown; a refresh (expiry, "Try again")
      // starts the next.
      for (;;) {
        const attempt = makeInflight();
        me.pushTeardown(() => attempt.abort());
        let requestRestart: () => void = () => {};
        const restart = new Promise<"restart">((resolve) => {
          requestRestart = () => resolve("restart");
        });
        const context: LoginQrContext = {
          mode: explicitMount ? "inline" : "modal",
          domain,
          titleId,
          getAppUrl: opts.ui?.getAppUrl ?? GET_APP_URL,
          // A no-op once this sign-in is over or the host re-called
          // signIn() from the `prson-login-refresh-requested` event.
          refresh: () => {
            if (!me.aborted && !attempt.aborted && _inflight === me) requestRestart();
          },
          cancel: () => void me.abort("sign-in closed"),
        };
        const ui: AttemptUi = { handle: null };
        const run = runAttempt(opts, { domain, getMount, theme, context, attempt, me, ui });
        run.catch(() => {
          /* raced below; an abandoned attempt may fail later, quietly */
        });

        try {
          const out = await Promise.race([run, restart, me.whenAborted]);
          if (out === "restart") {
            await attempt.abort();
            continue;
          }
          // Success: the code (and dialog) go; the transport stays for the session.
          ui.handle?.dispose();
          dialog.current?.dispose();
          return out;
        } catch (err) {
          if (err instanceof LoginAbortedError) throw err;
          // Show what went wrong where the person is looking.
          ui.handle?.update?.({ state: "error", message: friendlyError(err) });
          if (!dialog.current || !ui.handle?.update) {
            // Inline (the host owns the page and keeps the card, as 0.1
            // did), a renderer that can't show errors, or a failure
            // before any code was shown: reject now.
            if (dialog.current) await me.abort();
            throw err;
          }
          // In the dialog: wait for "Try again" (a new attempt) or close
          // (reject with this error rather than a bare "aborted").
          try {
            await Promise.race([restart, me.whenAborted]);
          } catch {
            throw err;
          }
          await attempt.abort();
        }
      }
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

/** Where "Don't have Prson? Get it" points unless `ui.getAppUrl` says otherwise. */
export const GET_APP_URL = "https://app.prson.net/";

type AttemptUi = { handle: LoginQrHandle | null };

/**
 * One code on screen, from the draft to a verified presentation. Every
 * wait is raced against both this attempt's and the whole sign-in's
 * abort, so a refresh or a closed dialog ends it at once.
 */
async function runAttempt(
  opts: SignInOptions,
  env: {
    domain: string;
    getMount: () => HTMLElement;
    theme: "light" | "dark" | "auto";
    context: LoginQrContext;
    attempt: InflightSignIn;
    me: InflightSignIn;
    ui: AttemptUi;
  },
): Promise<SignInResult> {
  const { domain, attempt, me } = env;
  const guard = <T>(p: Promise<T>): Promise<T> => Promise.race([p, attempt.whenAborted, me.whenAborted]);
  /** Throw `LoginAbortedError` if a newer signIn() (or a refresh) has displaced us. */
  const checkAborted = () => {
    if (me.aborted || attempt.aborted) throw new LoginAbortedError();
  };

  const ttlMaxMinutes = Math.min(
    Math.max(opts.ttlMinutes ?? DEFAULT_TTL_MINUTES, 1),
    MAX_TTL_MINUTES,
  );

  // 1. Generate the ephemeral X25519 keypair the wallet will encrypt
  //    its envelope to. Stays in memory only — never written to
  //    storage, never crosses any network boundary.
  const ephKeys = await guard(generateEphemeralKeypair());
  checkAborted();

  // 2. Build the verifier request blob. The reqId is content-bound
  //    so the wallet sees the same canonical bytes the Worker stored
  //    (anti-tamper, see SECURITY.md §3).
  const given = typeof opts.nonce === "function" ? await guard(Promise.resolve(opts.nonce())) : opts.nonce;
  checkAborted();
  if (given !== undefined && (typeof given !== "string" || !/^[A-Za-z0-9_-]{22,128}$/.test(given))) {
    throw new Error("nonce must be 22-128 base64url characters (at least 16 random bytes)");
  }
  const nonce = given ?? b64u(crypto.getRandomValues(new Uint8Array(32)));
  const request = {
    domain,
    nonce,
    browserPk: ephKeys.publicKeyB64u,
    required: opts.required ?? {},
    // Carried into the wallet's drawer so an "Anonymous" option is
    // offered. The SDK side enforces acceptance below at verify time;
    // the wallet enforces drawer UX based on this flag.
    allowAnonymous: opts.allowAnonymous === true,
    // Sponsorship offer (advisory on the wire — the server enforces
    // the stored grant's domain/caps/budget at charge time).
    ...(opts.sponsorship?.grantId ? { sponsorship: { grantId: opts.sponsorship.grantId } } : {}),
    // If set, instructs the wallet to mint a fresh random Ed25519
    // keypair for this single sign-in (no deterministic per-domain
    // HKDF). Closes M-5; see SignInOptions.ephemeralIdentity.
    ephemeralIdentity: opts.ephemeralIdentity === true,
    // QR-mode remote navigation — wallet surfaces Prev / Next /
    // Submit / Logout / Mouse on a persistent banner. See
    // SignInOptions.remoteNavigation + bind.ts:enableRemoteNavigation.
    remoteNavigation: opts.remoteNavigation === true,
    // Pre-grant mouse control — wallet enables the Touchpad /
    // Magic wand buttons on the banner drawer from session start.
    // See SignInOptions.mouseControl + bindMouse's ambient
    // subscriber path.
    mouseControl: opts.mouseControl === true,
    // Website notifications: the wallet offers an unticked opt-in row.
    // See SignInOptions.notifications.
    ...(opts.notifications === true ? { notifications: true } : {}),
    // App-to-app return leg — validated here (fail fast at the
    // integrator's desk) AND in the wallet (the enforcing side).
    ...(opts.returnUrl ? { returnUrl: validateReturnUrl(opts.returnUrl, domain) } : {}),
    ttlMaxMinutes,
  };

  // 3. Register the draft directly with the Cloudflare Worker.
  //    Anonymous + IP rate-limited. NO TURN allocation, NO Firebase
  //    in the path — the Worker is the single API surface and waits
  //    for the wallet to claim before allocating real capacity.
  const draft: DraftResult = await guard(
    createDraft(request, {
      signalingBase: resolveSignalingBase(opts),
    }),
  );
  checkAborted();

  // 4. Render the QR encoding the deep-link URL the wallet scans /
  //    the mobile browser taps. Register its teardown FIRST so an
  //    abort during signaling/connect immediately removes the
  //    on-screen artefact even before the network resources close.
  const qrUrl = buildDeepLinkUrl({
    reqId: draft.reqId,
    browserPk: ephKeys.publicKeyB64u,
    nonce,
    domain,
    request,
    serverTs: draft.serverTs,
  });
  const handle = renderLoginQr(qrUrl, env.getMount(), env.theme, env.context);
  env.ui.handle = handle;
  attempt.pushTeardown(() => handle.dispose());
  const show = (s: Parameters<NonNullable<LoginQrHandle["update"]>>[0]) => {
    if (!attempt.aborted && !me.aborted) void handle.update?.(s);
  };

  // 5. Open the WS to the Cloudflare Worker. The DO is in DRAFT until
  //    a wallet's /session/claim flips it to ACTIVE; we'll still
  //    receive cached SDP/ICE from the wallet at that point.
  const signaling = await guard(
    connectSignaling({
      url: draft.signalingWss,
      role: "browser",
      sigToken: draft.draftToken,
    }),
  );
  attempt.pushTeardown(() => signaling.close());
  checkAborted();
  // The wallet's first message means it claimed the code: the person
  // approved on the phone, which is now connecting.
  let scanned = false;
  signaling.onMessage((m) => {
    if (!scanned && (m.msg === "answer" || m.msg === "peer-ready")) {
      scanned = true;
      show({ state: "scanned" });
    }
  });

  // 6. Bring up the RTCPeerConnection + data channel. The browser
  //    side uses STUN only — relay capacity is allocated only after
  //    the wallet signs /session/claim, and the wallet is the peer
  //    that allocates the TURN relay. The browser reaches the
  //    wallet's relayed candidates as a remote address, no client-
  //    side TURN credentials needed.
  const transport = await guard(
    establishTransport({
      stunOnly: true,
      signaling,
      role: "browser",
      // When the Worker minted TURN creds at draft time, hand them
      // to the peer connection so the browser also has a relay
      // candidate. Older Workers may omit `turn` from the draft
      // response; falling back to STUN-only matches the prior
      // behaviour.
      turn: draft.turn,
    }),
  );
  // From here on, `transport` owns the signaling channel — its
  // close() will close the WS too.
  attempt.pushTeardown(() => transport.close());
  checkAborted();
  show({ state: "approving" });

  // 7. Wait for the wallet's encrypted envelope on the data channel.
  //    The wallet emits exactly one `prson_vp_v1 / msg=presentation`
  //    on initial sign-in; renewals come later via the session handle.
  const first = await guard(transport.awaitFirstMessage());
  checkAborted();
  show({ state: "verifying" });
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

  // Enforce the level floor against the VERIFIED claims (the wallet
  // already gates UX-side, but the host's policy must not depend on
  // the wallet's good behaviour). Anonymous-wallet credentials carry
  // no level claim and are governed by `allowAnonymous` alone.
  // Default floor is 1 — a `verified_human: false` (level-0)
  // credential is only accepted when the host explicitly set
  // `required.minVerificationLevel: 0`.
  if (verified.credential.vct !== ANONYMOUS_WALLET_VCT) {
    const minLevel = opts.required?.minVerificationLevel ?? 1;
    const claimedLevel =
      typeof verified.claims.verification_level === "number"
        ? verified.claims.verification_level
        : 0;
    if (claimedLevel < minLevel) {
      throw new Error(
        `Presentation rejected: verification_level ${claimedLevel} below required ${minLevel}`,
      );
    }
  }

  // Unique-human id (when required): the wallet attaches it to the
  // initial envelope; we gate on presence here and pass it through
  // OPAQUE — cryptographic verification belongs on the host's server
  // (verifier-node `verifyUniqueHumanId`), since a browser-side check
  // could be bypassed by the page's own code anyway.
  const uniqueHumanId =
    (envelope as { uniqueHumanId?: SignInResult["uniqueHumanId"] }).uniqueHumanId ?? null;
  if (opts.required?.uniqueHumanId === true && !uniqueHumanId) {
    throw new Error("Presentation rejected: required uniqueHumanId credential missing");
  }
  // Notification handle (when asked for and the person opted in):
  // opaque, like uniqueHumanId; the API checks it when the site sends.
  const notifyHandle = opts.notifications === true ? notifyHandleFrom(envelope) : null;
  checkAborted();

  // 9. Success: let the UI show it (a short check animation, skipped
  //    under reduced motion), then the caller tears the code down. The
  //    transport stays open for renewals; the session handle owns it
  //    from here on.
  const hold = handle.update?.({ state: "success", domain });
  if (hold && typeof (hold as Promise<void>).then === "function") {
    await Promise.race([hold, new Promise((r) => setTimeout(r, 1500))]);
  }
  checkAborted();

  // The host needs both the SignInResult (returned synchronously
  // below) AND a `signed_in` event on the typed event stream (so
  // `onAny` listeners get a uniform lifecycle log). We build the
  // result first, hand it to the session as the initial-signed-in
  // payload (the session fires `signed_in` via microtask), and
  // return the same object.
  const result: SignInResult = {
    sdJwtVc: presentationStr,
    nonce,
    claims: verified.claims,
    cnf: verified.cnf,
    credential: verified.credential,
    uniqueHumanId,
    ...(opts.notifications === true ? { notifications: notifyHandle ? { handle: notifyHandle } : null } : {}),
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
    // Public-profile fields the wallet may stamp onto the first
    // envelope. They aren't part of the verified-human VC (which
    // carries verification facts only), so without seeding here
    // the host's `session.displayName` would stay null until a
    // later `display-update` envelope.
    initialDisplayName: envelope.displayName,
    initialAvatar: envelope.avatar,
  });
  result.session = session;

  return result;
}

/** A failure in words the person signing in can act on. */
function friendlyError(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/Too many login sessions/i.test(m)) return "Too many sign-ins from this network. Wait a moment and try again.";
  if (/createDraft failed|Failed to fetch|NetworkError|signaling: WS/i.test(m)) {
    return "Couldn't reach Prson. Check your connection and try again.";
  }
  if (/uniqueHumanId/i.test(m)) return "This site needs a passport or ID card verified in the Prson app.";
  if (/verification_level/i.test(m)) return "This site needs a more verified identity than the one chosen.";
  if (/data channel/i.test(m)) return "Your phone couldn't connect to this browser. Try again.";
  return "Sign-in didn't finish. Try again.";
}

// Re-export for verifier-only consumers + custom UIs.
export { PrsonLoginSession };
export { NOTIFY_HANDLE, notifyHandleFrom } from "./notify.js";
export type { LoginQrContext, LoginQrHandle, LoginQrRenderer, LoginUiState } from "./qr.js";
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

/**
 * Validate SignInOptions.returnUrl: HTTPS, and its host (incl. any
 * explicit port) must equal the login domain exactly. The wallet
 * re-validates independently — this copy exists so a misconfigured
 * integration fails at the integrator's desk, not on the user's phone.
 */
function validateReturnUrl(returnUrl: string, domain: string): string {
  let parsed: URL;
  try {
    parsed = new URL(returnUrl);
  } catch {
    throw new Error(`returnUrl is not a valid URL: ${returnUrl}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      "returnUrl must be https:// (custom schemes are refused — any app " +
        "could claim them; use a Universal Link / App Link on your domain)"
    );
  }
  if (parsed.host.toLowerCase() !== domain.toLowerCase()) {
    throw new Error(
      `returnUrl host (${parsed.host}) must equal the login domain (${domain})`
    );
  }
  return returnUrl;
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
