/**
 * @prson/login-verifier — public API surface.
 *
 * The verifier is intentionally a pure function: pass in a
 * presentation string + expected audience + expected nonce, get back
 * a discriminated union telling you what's wrong (or the verified
 * claims). The runtime is stubbed in phase 1; the contract below is
 * stable.
 *
 * Implementation plan: build on top of `jose` for JWS verification
 * + a hand-written SD-JWT splitter (matches the Dart implementation
 * at mobile-app/prson_app/lib/core/utils/sd_jwt_present.dart). The
 * five verifier rules in ../../SECURITY.md §7 are the test matrix.
 */

// Local minimal JWK type — the runtime resolves to the corresponding
// `jose` type when consumers `npm install`, but the scaffold typechecks
// without node_modules so partners can read this contract before
// installing anything.
type JWK = {
  kty: string;
  alg?: string;
  kid?: string;
  use?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
};

/** Fetcher signature — compatible with WHATWG fetch, Node 18+, undici. */
type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export type VerifyOptions = {
  /** The site's effective origin, e.g. `https://example.com`. */
  expectedAudience: string;

  /** The single-use nonce you minted and bound to the in-flight login. */
  expectedNonce: string;

  /**
   * KB-JWT `iat` is rejected when older than this many seconds. The
   * SDK clamps wallet-side `iat` skew to ±30 s, so 60 s is a safe
   * default that tolerates clock drift + flight time.
   */
  maxKbJwtAgeSeconds?: number;

  /** Default: `did:web:app.prson.net`. */
  trustedIssuer?: string;

  /** Default: `https://app.prson.net/.well-known/jwt-vc-issuer`. */
  jwksUri?: string;

  /** Override the fetch impl (Cloudflare Workers, Node 16, …). */
  fetch?: FetchLike;

  /** Cache window for the issuer JWKS. Default 1 h. */
  jwksCacheTtlMs?: number;

  /**
   * VCTs the verifier accepts. Defaults to the two Prson VCTs; pass
   * a narrower list if you only want one (e.g. only verified-identity
   * for an over-18 site).
   */
  acceptedVcts?: readonly string[];
};

export type VerifyFailureReason =
  | "malformed"
  | "issuer_key_resolve_failed"
  | "issuer_sig_invalid"
  | "vc_expired"
  | "vc_not_yet_valid"
  | "vct_not_accepted"
  | "disclosure_unmatched"
  | "kb_missing"
  | "kb_sig_invalid"
  | "aud_mismatch"
  | "nonce_mismatch"
  | "sd_hash_mismatch"
  | "kb_iat_stale";

export type VerifyResult =
  | {
      ok: false;
      reason: VerifyFailureReason;
      /** Free-form diagnostic; do not parse. */
      detail?: string;
    }
  | {
      ok: true;
      claims: Record<string, unknown>;
      cnf: { jwk: { kty: "OKP"; crv: "Ed25519"; x: string } };
      credential: {
        vct: string;
        iss: string;
        kid: string;
        iat: number;
        expiresAt: number;
      };
      /** Names of the disclosures the holder forwarded. */
      disclosedClaimNames: string[];
    };

/**
 * Verify an SD-JWT-VC presentation as delivered by `@prson/login-sdk`.
 * See the five required checks in ../../SECURITY.md §7.
 */
export async function verifyPresentation(
  _presentation: string,
  _opts: VerifyOptions,
): Promise<VerifyResult> {
  throw new Error(
    "[@prson/login-verifier] phase 1 stub — runtime not yet implemented; " +
      "see login-sdk/README.md for the build order.",
  );
}

/**
 * Pure helper: resolve the notary issuer JWK by `kid` against the
 * Prson JWKS (or did:web doc). Exposed separately because verifiers
 * sometimes want to pre-warm the cache or check key availability
 * without committing to a full verification.
 */
export async function resolveIssuerKey(
  _kid: string,
  _opts?: Pick<VerifyOptions, "jwksUri" | "fetch" | "jwksCacheTtlMs" | "trustedIssuer">,
): Promise<JWK | null> {
  return null;
}
