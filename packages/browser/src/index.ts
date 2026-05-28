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
import { renderLoginQr } from "./qr.js";
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
// Public façade
// ─────────────────────────────────────────────────────────────────────

export class PrsonLogin {
  /**
   * Drive a full sign-in. The promise resolves once the wallet has
   * delivered a verified SD-JWT-VC; the returned session lives until
   * one of the four `ExpiryReason` triggers.
   */
  static async signIn(opts: SignInOptions = {}): Promise<SignInResult> {
    const domain = opts.domain ?? window.location.origin.replace(/^https?:\/\//, "");
    const ttlMaxMinutes = Math.min(
      Math.max(opts.ttlMinutes ?? DEFAULT_TTL_MINUTES, 1),
      MAX_TTL_MINUTES,
    );

    // 1. Generate the ephemeral X25519 keypair the wallet will encrypt
    //    its envelope to. Stays in memory only — never written to
    //    storage, never crosses any network boundary.
    const ephKeys = await generateEphemeralKeypair();

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
      ttlMaxMinutes,
    };

    // 3. Register the draft directly with the Cloudflare Worker.
    //    Anonymous + IP rate-limited. NO TURN allocation, NO Firebase
    //    in the path — the Worker is the single API surface and waits
    //    for the wallet to claim before allocating real capacity.
    const draft = await createDraft(request);

    // 4. Render the QR encoding the deep-link URL the wallet scans /
    //    the mobile browser taps.
    const qrUrl = buildDeepLinkUrl({
      reqId: draft.reqId,
      browserPk: ephKeys.publicKeyB64u,
      nonce,
      domain,
      request,
    });
    const qrMount = resolveMount(opts.ui?.mountQrInto);
    const qrHandle = qrMount ? renderLoginQr(qrUrl, qrMount, opts.ui?.theme ?? "auto") : null;

    // 5. Open the WS to the Cloudflare Worker. The DO is in DRAFT until
    //    a wallet's /session/claim flips it to ACTIVE; we'll still
    //    receive cached SDP/ICE from the wallet at that point.
    const signaling = await connectSignaling({
      url: draft.signalingWss,
      role: "browser",
      sigToken: draft.draftToken,
    });

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

    // 7. Wait for the wallet's encrypted envelope on the data channel.
    //    The wallet emits exactly one `prson_vp_v1 / msg=presentation`
    //    on initial sign-in; renewals come later via the session handle.
    const first = await transport.awaitFirstMessage();
    const envelope = await decryptEnvelope(first, ephKeys);
    if (envelope.v !== PROTOCOL_VERSION || envelope.msg !== "presentation") {
      throw new Error(`Unexpected first message: ${envelope.v}/${envelope.msg}`);
    }

    // 8. Verify the presentation cryptographically before we hand it
    //    to the host application. The five rules in SECURITY.md §7
    //    are enforced here. When allowAnonymous is set, we also accept
    //    the self-signed anonymous-wallet VCT (different verification
    //    path: cnf.jwk == issuer, no notary signature to check).
    const acceptedVcts = opts.allowAnonymous
      ? [...KNOWN_VCTS, ANONYMOUS_WALLET_VCT]
      : [...KNOWN_VCTS];
    const verified = await verifyPresentation(envelope.presentation, {
      expectedAudience: `https://${domain}`,
      expectedNonce: nonce,
      acceptedVcts,
      trustedIssuer: TRUSTED_ISSUER,
    });
    if (!verified.ok) {
      throw new Error(`Presentation rejected: ${verified.reason}`);
    }

    // 9. Tear down the QR + WS now that the sign-in is complete. The
    //    transport stays open for renewals; the session handle owns it.
    qrHandle?.dispose();

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
    });

    return {
      sdJwtVc: envelope.presentation,
      claims: verified.claims,
      cnf: verified.cnf,
      credential: verified.credential,
      session,
    };
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
}): string {
  const params = new URLSearchParams({
    s: args.reqId,
    p: args.browserPk,
    n: args.nonce,
    d: args.domain,
    req: b64u(new TextEncoder().encode(JSON.stringify(args.request))),
  });
  return `https://app.prson.net/login/v1?${params.toString()}`;
}
