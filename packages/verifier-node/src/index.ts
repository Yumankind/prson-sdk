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
import { createHash } from "node:crypto";
import { importJWK, jwtVerify } from "jose";

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

async function resolveIssuerJwk(
  kid: string,
  opts: Pick<VerifyOptions, "jwksUri" | "fetch" | "jwksCacheTtlMs" | "trustedIssuer">,
): Promise<unknown | null> {
  const uri = opts.jwksUri ?? DEFAULT_JWKS_URI;
  const ttl = opts.jwksCacheTtlMs ?? DEFAULT_JWKS_CACHE_TTL_MS;
  const cached = jwksCache.get(uri);
  if (cached && Date.now() - cached.fetchedAt < ttl) {
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
