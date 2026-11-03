/**
 * @prson/login-verifier — Node.js verifier for SD-JWT-VC presentations.
 *
 * Enforces the five rules in `../../SECURITY.md §7`. Built on top of
 * `jose` for JWS verification + a hand-written SD-JWT splitter that
 * mirrors the Dart implementation at
 * mobile-app/prson_app/lib/core/utils/sd_jwt_present.dart.
 *
 * Pure-function. No state beyond an in-memory JWKS cache (1-hour TTL).
 */
import { createHash, createPublicKey, createVerify } from "node:crypto";
import { importJWK, jwtVerify } from "jose";

export {
  canonicalJson,
  verdictDisclosureDigest,
  verifyVerdict,
  VERDICT_SCOPE_V1,
  VERDICT_SCOPE_V2,
} from "./verdict.js";
export type {
  VerdictDisclosure,
  VerdictDisclosureKind,
  VerdictEnvelope,
  VerdictPublicKey,
  VerifiedDisclosure,
  VerifyVerdictOptions,
  VerifyVerdictResult,
} from "./verdict.js";

// ── Public API ────────────────────────────────────────────────────────

type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export type VerifyOptions = {
  expectedAudience: string;
  expectedNonce: string;
  maxKbJwtAgeSeconds?: number;
  trustedIssuer?: string;
  jwksUri?: string;
  fetch?: FetchLike;
  jwksCacheTtlMs?: number;
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
  | { ok: false; reason: VerifyFailureReason; detail?: string }
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
      disclosedClaimNames: string[];
    };

const DEFAULT_TRUSTED_ISSUER = "did:web:app.prson.net";
const DEFAULT_JWKS_URI = "https://app.prson.net/.well-known/jwt-vc-issuer";
const DEFAULT_ACCEPTED_VCTS = [
  "https://app.prson.net/credentials/verified-human/v1",
  "https://app.prson.net/credentials/verified-identity/v1",
] as const;
const DEFAULT_MAX_KB_AGE_SECONDS = 60;
const DEFAULT_JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

export async function verifyPresentation(
  presentation: string,
  opts: VerifyOptions,
): Promise<VerifyResult> {
  if (typeof presentation !== "string" || presentation.length === 0) {
    return { ok: false, reason: "malformed", detail: "empty" };
  }
  const parts = presentation.split("~");
  if (parts.length < 2) return { ok: false, reason: "malformed", detail: "no tildes" };

  const jws = parts[0]!;
  const tail = parts.slice(1);
  const last = tail[tail.length - 1];
  let kbJwt: string;
  let discTokens: string[];
  if (!last) return { ok: false, reason: "kb_missing" };
  if (last.includes(".")) {
    kbJwt = last;
    discTokens = tail.slice(0, -1);
  } else if (last === "") {
    return { ok: false, reason: "kb_missing" };
  } else {
    // No KB-JWT slot was reserved — disclosed-only presentation; we
    // require KB for any login use case.
    return { ok: false, reason: "kb_missing" };
  }

  // ── 1. Parse + verify the issuer JWS ──────────────────────────────
  const [hB64, pB64, sigB64] = jws.split(".");
  if (!hB64 || !pB64 || !sigB64) {
    return { ok: false, reason: "malformed", detail: "jws shape" };
  }
  let header: { alg?: string; kid?: string; typ?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(b64uToString(hB64));
    payload = JSON.parse(b64uToString(pB64));
  } catch {
    return { ok: false, reason: "malformed", detail: "json" };
  }

  const trustedIssuer = opts.trustedIssuer ?? DEFAULT_TRUSTED_ISSUER;
  if (payload.iss !== trustedIssuer) {
    return {
      ok: false,
      reason: "issuer_key_resolve_failed",
      detail: `iss=${String(payload.iss)} expected=${trustedIssuer}`,
    };
  }
  const accepted = opts.acceptedVcts ?? DEFAULT_ACCEPTED_VCTS;
  if (typeof payload.vct !== "string" || !accepted.includes(payload.vct)) {
    return { ok: false, reason: "vct_not_accepted", detail: String(payload.vct) };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < nowSec) {
    return { ok: false, reason: "vc_expired" };
  }
  if (typeof payload.nbf === "number" && payload.nbf > nowSec + 30) {
    return { ok: false, reason: "vc_not_yet_valid" };
  }

  if (!header.kid) return { ok: false, reason: "issuer_key_resolve_failed", detail: "no kid" };
  const issuerJwk = await resolveIssuerJwk(header.kid, opts);
  if (!issuerJwk) return { ok: false, reason: "issuer_key_resolve_failed", detail: "unknown kid" };
  try {
    // jose's `jwtVerify` does header.alg lookup against the imported
    // key + JOSE-compliant signature verification + signing-input bytes.
    // Disabling iat/exp because we already validated `exp` above.
    await jwtVerify(jws, await importJWK(issuerJwk as Parameters<typeof importJWK>[0], "RS256"), {
      algorithms: ["RS256"],
      issuer: trustedIssuer,
      currentDate: new Date(nowSec * 1000),
    });
  } catch (e) {
    return { ok: false, reason: "issuer_sig_invalid", detail: (e as Error).message };
  }

  // ── 2. Verify every Disclosure digest is bound by the JWS's _sd ───
  const sdSet = collectSdDigests(payload);
  const disclosed: Array<{ name: string; value: unknown }> = [];
  for (const t of discTokens) {
    if (!t) continue;
    const digest = sha256B64u(t);
    if (!sdSet.has(digest)) {
      return { ok: false, reason: "disclosure_unmatched", detail: digest };
    }
    let arr: unknown[];
    try {
      arr = JSON.parse(b64uToString(t)) as unknown[];
    } catch {
      return { ok: false, reason: "malformed", detail: "disclosure json" };
    }
    if (Array.isArray(arr) && arr.length === 3 && typeof arr[1] === "string") {
      disclosed.push({ name: arr[1], value: arr[2] });
    }
  }

  // ── 3. Verify the KB-JWT ──────────────────────────────────────────
  const cnf = (payload.cnf as { jwk?: { kty?: string; crv?: string; x?: string } } | undefined)?.jwk;
  if (!cnf || cnf.kty !== "OKP" || cnf.crv !== "Ed25519" || typeof cnf.x !== "string") {
    return { ok: false, reason: "kb_missing", detail: "no cnf.jwk OKP/Ed25519" };
  }
  const [kbH, kbP, kbS] = kbJwt.split(".");
  if (!kbH || !kbP || !kbS) {
    return { ok: false, reason: "kb_sig_invalid", detail: "kb shape" };
  }
  let kbHeader: { alg?: string; typ?: string };
  let kbPayload: { aud?: string; nonce?: string; sd_hash?: string; iat?: number };
  try {
    kbHeader = JSON.parse(b64uToString(kbH));
    kbPayload = JSON.parse(b64uToString(kbP));
  } catch {
    return { ok: false, reason: "kb_sig_invalid", detail: "kb json" };
  }
  if (kbHeader.alg !== "EdDSA" || kbHeader.typ !== "kb+jwt") {
    return { ok: false, reason: "kb_sig_invalid", detail: "kb header" };
  }
  if (kbPayload.aud !== opts.expectedAudience) {
    return { ok: false, reason: "aud_mismatch", detail: String(kbPayload.aud) };
  }
  if (kbPayload.nonce !== opts.expectedNonce) {
    return { ok: false, reason: "nonce_mismatch" };
  }
  if (typeof kbPayload.iat !== "number") return { ok: false, reason: "kb_iat_stale" };
  const maxAge = opts.maxKbJwtAgeSeconds ?? DEFAULT_MAX_KB_AGE_SECONDS;
  if (Math.abs(nowSec - kbPayload.iat) > maxAge) {
    return { ok: false, reason: "kb_iat_stale", detail: `iat skew=${nowSec - kbPayload.iat}s` };
  }
  const presentationPrefix = `${jws}~${discTokens.join("~")}~`;
  if (kbPayload.sd_hash !== sha256B64u(presentationPrefix)) {
    return { ok: false, reason: "sd_hash_mismatch" };
  }

  // KB-JWT signature against cnf.jwk.
  try {
    await jwtVerify(
      kbJwt,
      await importJWK(cnf as Parameters<typeof importJWK>[0], "EdDSA"),
      { algorithms: ["EdDSA"] },
    );
  } catch (e) {
    return { ok: false, reason: "kb_sig_invalid", detail: (e as Error).message };
  }

  // ── 4. Build the verified claims map ──────────────────────────────
  const claims: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (k === "_sd" || k === "_sd_alg" || k === "cnf") continue;
    if (k === "iss" || k === "vct" || k === "iat" || k === "exp" || k === "nbf") continue;
    claims[k] = v;
  }
  for (const d of disclosed) claims[d.name] = d.value;

  return {
    ok: true,
    claims,
    cnf: { jwk: { kty: "OKP", crv: "Ed25519", x: cnf.x } },
    credential: {
      vct: payload.vct as string,
      iss: payload.iss as string,
      kid: header.kid,
      iat: typeof payload.iat === "number" ? payload.iat : 0,
      expiresAt: typeof payload.exp === "number" ? payload.exp * 1000 : 0,
    },
    disclosedClaimNames: disclosed.map((d) => d.name),
  };
}

// ── Predicate (fragment) verification ────────────────────────────────
//
// Predicates are signed boolean assertions about a verified Prson
// property — "age >= 18", "balance >= 5000 EUR", "doc not expired".
// They are minted on-demand by `signPropertyFragment` in three shapes,
// and the helpers below verify each. The shapes are deliberately tiny
// next to a full login presentation (no KB-JWT, no nonce, no audience)
// because a fragment is a transferable factual claim, not a sign-in
// proof — its anti-replay is the short TTL + the propertyHash binding.

const DEFAULT_PREDICATE_VCT = "https://app.prson.net/credentials/predicate/v1";

export type SignedFragmentNative = {
  fragmentId: string;
  value: boolean | number | string;
  description?: string;
  propertyHash: string;
  propertyType: string;
  identityId: string;
  /**
   * Present on audience-scoped (pairwise) fragments. When set,
   * `propertyHash` and `identityId` are pairwise identifiers derived
   * for THIS domain only — stable here, uncorrelatable anywhere else —
   * and the signature canonical carries an `:aud:<host>` suffix.
   */
  audience?: string;
  signedAt: string;
  expiresAt: string;
  signature: string;
  kid?: string;
};

export type FragmentVerifyOptions = Pick<
  VerifyOptions,
  "jwksUri" | "fetch" | "jwksCacheTtlMs" | "trustedIssuer"
> & {
  acceptedPredicateVcts?: readonly string[];
  /**
   * Your domain (host). REQUIRED to accept audience-scoped fragments:
   * the fragment's `audience` must equal this value or verification
   * fails with `audience_mismatch` (a pairwise fragment minted for
   * another relying party must never verify here). Legacy fragments
   * (no `audience` field) are unaffected.
   */
  expectedAudience?: string;
  /** Override the current time, for deterministic tests. */
  now?: Date;
};

export type FragmentVerifyFailureReason =
  | "malformed"
  | "issuer_key_resolve_failed"
  | "issuer_sig_invalid"
  | "expired"
  | "vct_not_accepted"
  | "unsupported_format"
  | "audience_mismatch";

export type FragmentVerifyResult =
  | { ok: false; reason: FragmentVerifyFailureReason; detail?: string }
  | {
      ok: true;
      format: "native" | "vc+jwt" | "vc+sd-jwt";
      fragmentId: string;
      value: boolean | number | string;
      propertyHash: string;
      propertyType: string;
      identityId: string;
      signedAt: string;
      expiresAt: string;
      description?: string;
      kid: string;
    };

/**
 * Verify a Prson-native signed fragment. The signature is RSA-SHA256
 * over the colon-delimited canonical string
 * `${propertyHash}:${fragmentId}:${value}:${identityId}:${signedAt}:${expiresAt}`
 * — identical bytes to what the server signed in
 * `functions/utils/predicateFormatters.js#formatNative`.
 */
export async function verifySignedFragment(
  fragment: SignedFragmentNative,
  opts: FragmentVerifyOptions = {},
): Promise<FragmentVerifyResult> {
  if (
    !fragment ||
    typeof fragment.signature !== "string" ||
    typeof fragment.propertyHash !== "string" ||
    typeof fragment.fragmentId !== "string" ||
    typeof fragment.identityId !== "string" ||
    typeof fragment.signedAt !== "string" ||
    typeof fragment.expiresAt !== "string" ||
    typeof fragment.kid !== "string"
  ) {
    return { ok: false, reason: "malformed", detail: "missing required fields" };
  }
  const now = (opts.now ?? new Date()).getTime();
  if (new Date(fragment.expiresAt).getTime() <= now) {
    return { ok: false, reason: "expired" };
  }
  // Audience-scoped (pairwise) fragments are domain-bound: the verifier
  // must declare its own host and it must match what the issuer bound.
  if (fragment.audience != null) {
    const expected = (opts.expectedAudience ?? "").trim().toLowerCase();
    if (!expected || expected !== String(fragment.audience).toLowerCase()) {
      return {
        ok: false,
        reason: "audience_mismatch",
        detail: `fragment bound to '${fragment.audience}', expectedAudience='${expected || "(unset)"}'`,
      };
    }
  }
  const jwk = await resolveIssuerJwk(fragment.kid, opts);
  if (!jwk) return { ok: false, reason: "issuer_key_resolve_failed", detail: fragment.kid };
  let pem: ReturnType<typeof createPublicKey>;
  try {
    pem = createPublicKey({ key: jwk as import("node:crypto").JsonWebKey, format: "jwk" });
  } catch (e) {
    return { ok: false, reason: "issuer_key_resolve_failed", detail: (e as Error).message };
  }
  const base = `${fragment.propertyHash}:${fragment.fragmentId}:${fragment.value}:${fragment.identityId}:${fragment.signedAt}:${fragment.expiresAt}`;
  const dataToSign = fragment.audience != null ? `${base}:aud:${fragment.audience}` : base;
  const verifier = createVerify("RSA-SHA256");
  verifier.update(dataToSign);
  verifier.end();
  let sigBytes: Buffer;
  try {
    sigBytes = Buffer.from(fragment.signature, "base64");
  } catch (e) {
    return { ok: false, reason: "malformed", detail: `signature b64: ${(e as Error).message}` };
  }
  if (!verifier.verify(pem, sigBytes)) {
    return { ok: false, reason: "issuer_sig_invalid" };
  }
  return {
    ok: true,
    format: "native",
    fragmentId: fragment.fragmentId,
    value: fragment.value,
    propertyHash: fragment.propertyHash,
    propertyType: fragment.propertyType,
    identityId: fragment.identityId,
    signedAt: fragment.signedAt,
    expiresAt: fragment.expiresAt,
    // Not returned: the native signature doesn't cover the description, so a
    // holder could change it. Label the fact from `fragmentId`.
    kid: fragment.kid,
  };
}

/**
 * Verify a JWT-shaped signed fragment. Detects the variant from the
 * JWS `typ` header:
 *
 *   * `vc+jwt`  — plain W3C VC Data Model 2.0 JWS. The predicate sits
 *                 in `credentialSubject`.
 *   * `sd-jwt`  — IETF SD-JWT-VC. The disclosure (joined by `~`) is
 *                 hashed and matched against `_sd[0]`.
 *
 * Anything else fails with `unsupported_format`.
 */
export async function verifyFragmentCredential(
  credential: string,
  opts: FragmentVerifyOptions = {},
): Promise<FragmentVerifyResult> {
  if (typeof credential !== "string" || credential.length === 0) {
    return { ok: false, reason: "malformed", detail: "empty" };
  }
  const accepted = opts.acceptedPredicateVcts ?? [DEFAULT_PREDICATE_VCT];
  // SD-JWT-VC compact form ends with `~`; split it off before treating
  // the head as a JWS.
  const tildeIdx = credential.indexOf("~");
  const jws = tildeIdx < 0 ? credential : credential.slice(0, tildeIdx);
  const discTokens =
    tildeIdx < 0
      ? []
      : credential
          .slice(tildeIdx + 1)
          .split("~")
          .filter((s) => s.length > 0);

  const [hB64, pB64, sigB64] = jws.split(".");
  if (!hB64 || !pB64 || !sigB64) {
    return { ok: false, reason: "malformed", detail: "jws shape" };
  }
  let header: { alg?: string; kid?: string; typ?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(b64uToString(hB64));
    payload = JSON.parse(b64uToString(pB64));
  } catch (e) {
    return { ok: false, reason: "malformed", detail: `json: ${(e as Error).message}` };
  }

  let format: "vc+jwt" | "vc+sd-jwt";
  if (header.typ === "vc+jwt") {
    format = "vc+jwt";
  } else if (header.typ === "sd-jwt") {
    format = "vc+sd-jwt";
  } else {
    return { ok: false, reason: "unsupported_format", detail: String(header.typ) };
  }
  if (typeof payload.vct !== "string" || !accepted.includes(payload.vct)) {
    return { ok: false, reason: "vct_not_accepted", detail: String(payload.vct) };
  }

  const trustedIssuer = opts.trustedIssuer ?? DEFAULT_TRUSTED_ISSUER;
  if (payload.iss !== trustedIssuer) {
    return { ok: false, reason: "issuer_key_resolve_failed", detail: `iss=${String(payload.iss)}` };
  }
  const nowSec = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  // Prson always sets an expiry; a credential without one is not Prson's.
  if (typeof payload.exp !== "number") {
    return { ok: false, reason: "malformed", detail: "no exp" };
  }
  if (payload.exp < nowSec) {
    return { ok: false, reason: "expired" };
  }
  // Audience-scoped credentials are bound to one relying party, the same rule
  // as verifySignedFragment: a fact minted for another site never verifies here.
  if (payload.aud != null) {
    const expected = (opts.expectedAudience ?? "").trim().toLowerCase();
    const bound = (Array.isArray(payload.aud) ? payload.aud : [payload.aud]).map((a) => String(a).toLowerCase());
    if (!expected || !bound.includes(expected)) {
      return {
        ok: false,
        reason: "audience_mismatch",
        detail: `credential bound to '${bound.join(",")}', expectedAudience='${expected || "(unset)"}'`,
      };
    }
  }
  if (!header.kid) return { ok: false, reason: "issuer_key_resolve_failed", detail: "no kid" };
  const issuerJwk = await resolveIssuerJwk(header.kid, opts);
  if (!issuerJwk) return { ok: false, reason: "issuer_key_resolve_failed", detail: "unknown kid" };
  try {
    await jwtVerify(jws, await importJWK(issuerJwk as Parameters<typeof importJWK>[0], "RS256"), {
      algorithms: ["RS256"],
      issuer: trustedIssuer,
      currentDate: new Date(nowSec * 1000),
    });
  } catch (e) {
    return { ok: false, reason: "issuer_sig_invalid", detail: (e as Error).message };
  }

  // Pull the predicate value out of whichever slot the format uses.
  let fragmentId: string;
  let value: boolean | number | string;
  if (format === "vc+jwt") {
    const subj = payload.credentialSubject as Record<string, unknown> | undefined;
    if (!subj || typeof subj.fragmentId !== "string") {
      return { ok: false, reason: "malformed", detail: "credentialSubject" };
    }
    fragmentId = subj.fragmentId;
    value = subj.value as boolean | number | string;
    const propertyHash = String(subj.propertyHash ?? "");
    const propertyType = String(subj.propertyType ?? "");
    const identityId = String(subj.id ?? payload.sub ?? "");
    return {
      ok: true,
      format,
      fragmentId,
      value,
      propertyHash,
      propertyType,
      identityId,
      signedAt: typeof payload.iat === "number" ? new Date(payload.iat * 1000).toISOString() : "",
      expiresAt: typeof payload.exp === "number" ? new Date(payload.exp * 1000).toISOString() : "",
      description: typeof subj.description === "string" ? subj.description : undefined,
      kid: header.kid,
    };
  }

  // SD-JWT-VC: rehash the disclosure(s), match against `_sd`, and pull
  // [salt, name, value] out of the matched disclosure for the result.
  const sdSet = collectSdDigests(payload);
  if (discTokens.length === 0) {
    return { ok: false, reason: "malformed", detail: "no disclosure" };
  }
  let matched: { name: string; val: unknown } | null = null;
  for (const t of discTokens) {
    const digest = sha256B64u(t);
    if (!sdSet.has(digest)) {
      return { ok: false, reason: "malformed", detail: `unmatched disclosure ${digest}` };
    }
    try {
      const arr = JSON.parse(b64uToString(t)) as unknown[];
      if (Array.isArray(arr) && arr.length === 3 && typeof arr[1] === "string") {
        matched = { name: arr[1], val: arr[2] };
      }
    } catch {
      return { ok: false, reason: "malformed", detail: "disclosure json" };
    }
  }
  if (!matched) {
    return { ok: false, reason: "malformed", detail: "no parseable disclosure" };
  }
  return {
    ok: true,
    format,
    fragmentId: matched.name,
    value: matched.val as boolean | number | string,
    propertyHash: String(payload.propertyHash ?? ""),
    propertyType: String(payload.propertyType ?? ""),
    identityId: String(payload.sub ?? ""),
    signedAt: typeof payload.iat === "number" ? new Date(payload.iat * 1000).toISOString() : "",
    expiresAt: typeof payload.exp === "number" ? new Date(payload.exp * 1000).toISOString() : "",
    description: typeof payload.description === "string" ? payload.description : undefined,
    kid: header.kid,
  };
}

/**
 * Resolve a Prson notary issuer JWK by `kid` against the published
 * JWKS. Exposed separately so verifiers can pre-warm the cache.
 */
export async function resolveIssuerKey(
  kid: string,
  opts: Pick<VerifyOptions, "jwksUri" | "fetch" | "jwksCacheTtlMs" | "trustedIssuer"> = {},
): Promise<unknown | null> {
  return resolveIssuerJwk(kid, opts);
}

// ── Internals ─────────────────────────────────────────────────────────

const jwksCache = new Map<string, { fetchedAt: number; keys: Record<string, unknown> }>();
const JWKS_REFETCH_MIN_MS = 60_000;

async function resolveIssuerJwk(
  kid: string,
  opts: Pick<VerifyOptions, "jwksUri" | "fetch" | "jwksCacheTtlMs" | "trustedIssuer">,
): Promise<unknown | null> {
  const uri = opts.jwksUri ?? DEFAULT_JWKS_URI;
  const ttl = opts.jwksCacheTtlMs ?? DEFAULT_JWKS_CACHE_TTL_MS;
  const cached = jwksCache.get(uri);
  // A kid we don't know yet usually means Prson just rotated its key: look
  // again, but at most once a minute (so unknown kids can't hammer the JWKS).
  const fresh = cached && Date.now() - cached.fetchedAt < ttl;
  if (fresh && (cached.keys[kid] || Date.now() - cached.fetchedAt < JWKS_REFETCH_MIN_MS)) {
    return cached.keys[kid] ?? null;
  }
  const fetchImpl = (opts.fetch ?? (globalThis as unknown as { fetch: FetchLike }).fetch) as FetchLike;
  const res = await fetchImpl(uri);
  if (!res.ok) return null;
  const body = (await res.json()) as { jwks?: { keys: Array<Record<string, unknown>> }; keys?: Array<Record<string, unknown>> };
  const keys = body.jwks?.keys ?? body.keys ?? [];
  const map: Record<string, unknown> = {};
  for (const k of keys) {
    const id = (k as { kid?: string }).kid;
    if (id) map[id] = k;
  }
  jwksCache.set(uri, { fetchedAt: Date.now(), keys: map });
  return map[kid] ?? null;
}

function collectSdDigests(payload: unknown, out = new Set<string>()): Set<string> {
  if (!payload || typeof payload !== "object") return out;
  if (Array.isArray(payload)) {
    for (const v of payload) collectSdDigests(v, out);
    return out;
  }
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (k === "_sd" && Array.isArray(v)) {
      for (const d of v) if (typeof d === "string") out.add(d);
    } else if (typeof v === "object") {
      collectSdDigests(v, out);
    }
  }
  return out;
}

function sha256B64u(input: string): string {
  return createHash("sha256").update(input, "ascii").digest("base64url");
}

function b64uToString(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

// ── Unique-human id verification (domain-scoped uniqueness) ─────────
//
// `issueUniqueHumanId` mints a notary-signed envelope proving "one
// unique, government-document-verified human at YOUR domain". The
// `uniqueIdHash` is a pairwise identifier: stable for the same human at
// your domain (use it as a sybil-resistant account key), cryptographically
// uncorrelatable with the id the same human gets anywhere else. No
// global identifier (wallet id, identity id, document hash/number) is
// present in the envelope.

export type UniqueHumanIdEnvelope = {
  scope: "prson-unique-human/1";
  audience: string;
  uniqueIdHash: string;
  trustTier: "nfc" | "mrz";
  verificationLevel: number;
  documentType: string | null;
  issuingCountry: string | null;
  signedAt: string;
  expiresAt: string;
};

export type UniqueHumanIdCredential = {
  envelope: UniqueHumanIdEnvelope;
  signature: string;
  kid: string;
};

export type UniqueHumanIdVerifyResult =
  | { ok: false; reason: FragmentVerifyFailureReason; detail?: string }
  | { ok: true; uniqueIdHash: string; envelope: UniqueHumanIdEnvelope; kid: string };

/**
 * Sorted-keys JSON canonicalisation — byte-identical port of the
 * server's `functions/utils/signatureUtils.js#canonicalStringify`,
 * which is what the notary signed.
 */
function canonicalStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "boolean" || typeof obj === "number") return obj.toString();
  if (typeof obj === "string") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalStringify).join(",") + "]";
  if (typeof obj === "object") {
    const rec = obj as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    return (
      "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalStringify(rec[k])).join(",") + "}"
    );
  }
  return JSON.stringify(obj);
}

/**
 * Verify a unique-human-id credential. Checks, in order: shape, scope,
 * audience binding (must equal YOUR host — pass `expectedAudience`),
 * expiry, and the notary RSA-SHA256 signature against the published
 * JWKS (kid-pinned). On success, `uniqueIdHash` is safe to use as the
 * per-domain uniqueness key.
 */
export async function verifyUniqueHumanId(
  credential: UniqueHumanIdCredential,
  opts: FragmentVerifyOptions = {},
): Promise<UniqueHumanIdVerifyResult> {
  const env = credential?.envelope;
  if (
    !env ||
    typeof credential.signature !== "string" ||
    typeof credential.kid !== "string" ||
    typeof env.uniqueIdHash !== "string" ||
    typeof env.audience !== "string" ||
    typeof env.signedAt !== "string" ||
    typeof env.expiresAt !== "string"
  ) {
    return { ok: false, reason: "malformed", detail: "missing required fields" };
  }
  if (env.scope !== "prson-unique-human/1") {
    return { ok: false, reason: "unsupported_format", detail: `scope ${String(env.scope)}` };
  }
  const expected = (opts.expectedAudience ?? "").trim().toLowerCase();
  if (!expected || expected !== env.audience.toLowerCase()) {
    return {
      ok: false,
      reason: "audience_mismatch",
      detail: `bound to '${env.audience}', expectedAudience='${expected || "(unset)"}'`,
    };
  }
  const now = (opts.now ?? new Date()).getTime();
  if (new Date(env.expiresAt).getTime() <= now) {
    return { ok: false, reason: "expired" };
  }
  const jwk = await resolveIssuerJwk(credential.kid, opts);
  if (!jwk) return { ok: false, reason: "issuer_key_resolve_failed", detail: credential.kid };
  let pem: ReturnType<typeof createPublicKey>;
  try {
    pem = createPublicKey({ key: jwk as import("node:crypto").JsonWebKey, format: "jwk" });
  } catch (e) {
    return { ok: false, reason: "issuer_key_resolve_failed", detail: (e as Error).message };
  }
  const verifier = createVerify("RSA-SHA256");
  verifier.update(canonicalStringify(env));
  verifier.end();
  let sigBytes: Buffer;
  try {
    sigBytes = Buffer.from(credential.signature, "base64");
  } catch (e) {
    return { ok: false, reason: "malformed", detail: `signature b64: ${(e as Error).message}` };
  }
  if (!verifier.verify(pem, sigBytes)) {
    return { ok: false, reason: "issuer_sig_invalid" };
  }
  return { ok: true, uniqueIdHash: env.uniqueIdHash, envelope: env, kid: credential.kid };
}
