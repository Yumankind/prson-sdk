/**
 * @prson/login-sdk — public API surface.
 *
 * This file is the contract. The implementation is intentionally
 * stubbed: phase 1 ships the types + docs so partners can typecheck
 * against the API while phase 2 wires the LiveKit transport + crypto.
 *
 * See ../../ARCHITECTURE.md for the wire-format spec and
 * ../../SECURITY.md for the threat model.
 */

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export type SignInOptions = {
  /**
   * The verifier identifier bound into the KB-JWT `aud`. Defaults to
   * `window.location.origin`. Pass explicitly only if the SDK is
   * embedded in an iframe with a different effective origin than the
   * host page.
   */
  domain?: string;

  /**
   * What the verifier (you) requires from the holder. Surfaces in the
   * wallet's login drawer; the user can refuse. Unspecified = the
   * baseline `verified_human` claim only.
   */
  required?: {
    /** 1..6. Default: 1. Use 5 to gate on NFC-backed VC. */
    minVerificationLevel?: 1 | 2 | 3 | 4 | 5 | 6;

    /**
     * Standard SD-JWT-VC claim names from the credential schema —
     * e.g. `given_name`, `family_name`, `birthdate`, `nationalities`.
     */
    requiredClaims?: string[];

    /**
     * Predicate ids from the Prson fragment catalog — e.g.
     * `age_gte_18`, `issuing_country_in_eu`. Signed by the notary on
     * demand at presentation; never bakes raw values into the VC.
     */
    predicates?: string[];

    /** Default `"personal"`. */
    identityType?: "personal" | "organization";
  };

  /** Credential validity in minutes. 1..15, default 10. */
  ttlMinutes?: number;

  ui?: {
    /** Where to mount the QR + status. CSS selector or HTMLElement. */
    mountQrInto?: string | HTMLElement;
    /** Default: matches the user's `prefers-color-scheme`. */
    theme?: "light" | "dark" | "auto";
  };

  /**
   * If `true`, the SDK pre-allocates the LiveKit room + ephemeral
   * keys but waits for `.proceed()` before opening the channel.
   */
  defer?: boolean;
};

export type CnfJwk = {
  kty: "OKP";
  crv: "Ed25519";
  /** Base64url(without-padding) of the holder's 32-byte Ed25519 pk. */
  x: string;
};

export type SignInResult = {
  /** Compact SD-JWT-VC presentation: `<JWS>~<d_1>~…~<d_n>~<KB-JWT>`. */
  sdJwtVc: string;

  /** Decoded + verified disclosed claims, ready to consume. */
  claims: Record<string, unknown>;

  /** Holder Ed25519 public JWK from the VC's `cnf.jwk`. */
  cnf: { jwk: CnfJwk };

  credential: {
    vct: string;
    iss: string;
    kid: string;
    /** Ms epoch. The session helper tracks this. */
    expiresAt: number;
  };

  session: PrsonLoginSession;
};

export type ExpiryReason =
  | "ttl_reached"
  | "wallet_signed_out"
  | "user_revoked"
  | "network_loss"
  | "credential_revoked";

export interface PrsonLoginSession {
  /** Ms epoch of the current credential's `exp`. Updates on renewal. */
  readonly expiresAt: number;

  /** Cnf jwk of the credential — stable across renewals. */
  readonly cnf: { jwk: CnfJwk };

  /** Subscribe to wallet-pushed renewals. */
  onRenewed(cb: (fresh: SignInResult) => void): void;

  /** Fires when the session ends, for any reason. */
  onExpiry(cb: (reason: ExpiryReason) => void): void;

  /** Voluntary close; tells the wallet the user signed out. */
  close(): void;
}

// ─────────────────────────────────────────────────────────────────────
// Public façade
// ─────────────────────────────────────────────────────────────────────

export class PrsonLogin {
  /**
   * Start a sign-in flow. Resolves once the wallet has delivered a
   * verified SD-JWT-VC. The returned session lives until cancelled,
   * the credential expires, or the wallet revokes.
   */
  static async signIn(_opts: SignInOptions = {}): Promise<SignInResult> {
    throw new Error(
      "[@prson/login-sdk] phase 1 stub — runtime not yet implemented; " +
        "see login-sdk/README.md for the build order.",
    );
  }

  /**
   * Rebind to a session that was previously established (e.g. after
   * a page reload). Returns null if no session is recoverable for the
   * given holder key.
   */
  static async restore(_opts: {
    cnfJwk: CnfJwk;
    onExpiry?: (reason: ExpiryReason) => void;
  }): Promise<PrsonLoginSession | null> {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Internal protocol constants — exported for the verifier package
// and for diagnostic tooling. NOT part of the stable public API.
// ─────────────────────────────────────────────────────────────────────

/** Wire-format version carried in every LiveKit data-channel envelope. */
export const PROTOCOL_VERSION = "prson_vp_v1";

/** Issuer DID the SDK trusts. Verifiers should match this exactly. */
export const TRUSTED_ISSUER = "did:web:app.prson.net";

/** Known VCTs the SDK accepts at present. */
export const KNOWN_VCTS = [
  "https://app.prson.net/credentials/verified-human/v1",
  "https://app.prson.net/credentials/verified-identity/v1",
] as const;

/** Default TTL in minutes if `ttlMinutes` isn't supplied. */
export const DEFAULT_TTL_MINUTES = 10;

/** Hard cap enforced by `signIn`. */
export const MAX_TTL_MINUTES = 15;
