/**
 * Browser-side SD-JWT-VC verification. The SDK enforces all five rules
 * from SECURITY.md §7 before resolving signIn(); the verifier-node
 * package re-enforces them server-side.
 *
 * We do this in the browser too — even though the host site must
 * re-verify on its backend — because:
 *
 *   (a) failing fast in the SDK gives partners better DX (clear errors
 *       before anything reaches their backend); and
 *   (b) the cnf.jwk we expose to the host as the user identifier MUST
 *       have actually signed the presentation we deliver, otherwise
 *       sloppy callers could be tricked into trusting a forged cnf.
 *
 * Implementation uses Web Crypto for RS256 + Ed25519 verification.
 * Web Crypto's Ed25519 support landed in all major browsers in 2023+;
 * for older targets we'd polyfill with `@stablelib/ed25519`.
 */
import type { CnfJwk } from "./index.js";

export type VerifyOptions = {
  expectedAudience: string;
  expectedNonce: string;
  acceptedVcts: string[];
  trustedIssuer: string; // e.g. "did:web:app.prson.net"
  maxKbAgeSeconds?: number; // default 60
  jwksUri?: string;        // override (default: derived from trustedIssuer)
};

export type VerifyOk = {
  ok: true;
  claims: Record<string, unknown>;
  cnf: { jwk: CnfJwk };
  credential: {
    vct: string;
    iss: string;
    kid: string;
    expiresAt: number;
  };
};

export type VerifyErr = {
  ok: false;
  reason:
    | "malformed"
    | "issuer_key_resolve_failed"
    | "issuer_sig_invalid"
    | "vc_expired"
    | "vct_not_accepted"
    | "disclosure_unmatched"
    | "kb_missing"
    | "kb_sig_invalid"
    | "aud_mismatch"
    | "nonce_mismatch"
    | "sd_hash_mismatch"
    | "kb_iat_stale";
};

export type VerifyResult = VerifyOk | VerifyErr;

export async function verifyPresentation(
  sdJwt: string,
  opts: VerifyOptions,
): Promise<VerifyResult> {
  const parts = sdJwt.split("~");
  if (parts.length < 2) return { ok: false, reason: "malformed" };

  const jws = parts[0]!;
  const tail = parts.slice(1);
  const last = tail[tail.length - 1];
  let kbJwt: string | undefined;
  let discTokens: string[];
  if (last === "" || last === undefined) {
    discTokens = tail.slice(0, -1);
    return { ok: false, reason: "kb_missing" };
  } else if (last.includes(".")) {
    kbJwt = last;
    discTokens = tail.slice(0, -1);
  } else {
    return { ok: false, reason: "kb_missing" };
  }

  // ── 1. Parse the issuer JWS ─────────────────────────────────────
  const [hB64, pB64, sigB64] = jws.split(".");
  if (!hB64 || !pB64 || !sigB64) return { ok: false, reason: "malformed" };
  let header: { alg?: string; kid?: string; typ?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(b64uBytes(hB64)));
    payload = JSON.parse(new TextDecoder().decode(b64uBytes(pB64)));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload.iss !== "string" || payload.iss !== opts.trustedIssuer) {
    return { ok: false, reason: "issuer_key_resolve_failed" };
  }
  if (typeof payload.vct !== "string" || !opts.acceptedVcts.includes(payload.vct)) {
    return { ok: false, reason: "vct_not_accepted" };
  }
  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) {
    return { ok: false, reason: "vc_expired" };
  }

  // ── 2. Resolve the issuer JWK + verify the JWS signature ───────
  const issuerJwk = await resolveIssuerJwk(header.kid ?? "", opts);
  if (!issuerJwk) return { ok: false, reason: "issuer_key_resolve_failed" };
  const issuerKey = await crypto.subtle.importKey(
    "jwk",
    issuerJwk as JsonWebKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const issuerOk = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    issuerKey,
    b64uBytes(sigB64),
    new TextEncoder().encode(`${hB64}.${pB64}`),
  );
  if (!issuerOk) return { ok: false, reason: "issuer_sig_invalid" };

  // ── 3. Verify every Disclosure digest is in the JWS's _sd ──────
  const sdSet = collectSdDigests(payload);
  const disclosed: Array<{ name: string; value: unknown }> = [];
  for (const t of discTokens) {
    if (!t) continue;
    const arr = JSON.parse(new TextDecoder().decode(b64uBytes(t))) as unknown[];
    if (!Array.isArray(arr) || arr.length < 2) {
      return { ok: false, reason: "disclosure_unmatched" };
    }
    const digest = b64uEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))));
    if (!sdSet.has(digest)) return { ok: false, reason: "disclosure_unmatched" };
    if (arr.length === 3 && typeof arr[1] === "string") {
      disclosed.push({ name: arr[1], value: arr[2] });
    }
  }

  // ── 4. Verify the KB-JWT ───────────────────────────────────────
  if (!kbJwt) return { ok: false, reason: "kb_missing" };
  const cnf = (payload.cnf as { jwk?: CnfJwk } | undefined)?.jwk;
  if (!cnf || cnf.kty !== "OKP" || cnf.crv !== "Ed25519") {
    return { ok: false, reason: "kb_missing" };
  }
  const [kbH, kbP, kbS] = kbJwt.split(".");
  if (!kbH || !kbP || !kbS) return { ok: false, reason: "kb_sig_invalid" };
  let kbHeader: { alg?: string; typ?: string };
  let kbPayload: { aud?: string; nonce?: string; sd_hash?: string; iat?: number };
  try {
    kbHeader = JSON.parse(new TextDecoder().decode(b64uBytes(kbH)));
    kbPayload = JSON.parse(new TextDecoder().decode(b64uBytes(kbP)));
  } catch {
    return { ok: false, reason: "kb_sig_invalid" };
  }
  if (kbHeader.alg !== "EdDSA" || kbHeader.typ !== "kb+jwt") {
    return { ok: false, reason: "kb_sig_invalid" };
  }
  if (kbPayload.aud !== opts.expectedAudience) return { ok: false, reason: "aud_mismatch" };
  if (kbPayload.nonce !== opts.expectedNonce) return { ok: false, reason: "nonce_mismatch" };
  if (typeof kbPayload.iat !== "number") return { ok: false, reason: "kb_iat_stale" };
  const maxAge = opts.maxKbAgeSeconds ?? 60;
  if (Math.abs(Date.now() / 1000 - kbPayload.iat) > maxAge) {
    return { ok: false, reason: "kb_iat_stale" };
  }
  const presentationPrefix = `${jws}~${discTokens.join("~")}~`;
  const sdHash = b64uEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(presentationPrefix))));
  if (kbPayload.sd_hash !== sdHash) return { ok: false, reason: "sd_hash_mismatch" };

  const holderKey = await crypto.subtle.importKey(
    "jwk",
    cnf as JsonWebKey,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const kbOk = await crypto.subtle.verify(
    "Ed25519",
    holderKey,
    b64uBytes(kbS),
    new TextEncoder().encode(`${kbH}.${kbP}`),
  );
  if (!kbOk) return { ok: false, reason: "kb_sig_invalid" };

  // ── 5. Reassemble disclosed claims ──────────────────────────────
  const claims: Record<string, unknown> = {};
  // Always-visible top-level claims from the JWS (minus SD internals).
  for (const [k, v] of Object.entries(payload)) {
    if (k === "_sd" || k === "_sd_alg" || k === "cnf") continue;
    if (["iss", "vct", "iat", "exp"].includes(k)) continue;
    claims[k] = v;
  }
  for (const d of disclosed) claims[d.name] = d.value;

  return {
    ok: true,
    claims,
    cnf: { jwk: cnf },
    credential: {
      vct: payload.vct as string,
      iss: payload.iss as string,
      kid: (header.kid ?? "") as string,
      expiresAt: typeof payload.exp === "number" ? payload.exp * 1000 : 0,
    },
  };
}

/** Lazy in-memory cache of the Prson issuer JWKS. 1 h TTL. */
const jwksCache = new Map<string, { fetchedAt: number; keys: Record<string, JsonWebKey> }>();

async function resolveIssuerJwk(
  kid: string,
  opts: VerifyOptions,
): Promise<JsonWebKey | null> {
  if (!kid) return null;
  // did:web:app.prson.net → https://app.prson.net/.well-known/jwt-vc-issuer.
  const host = opts.trustedIssuer.replace(/^did:web:/, "");
  const uri = opts.jwksUri ?? `https://${host}/.well-known/jwt-vc-issuer`;
  const cached = jwksCache.get(uri);
  if (cached && Date.now() - cached.fetchedAt < 60 * 60 * 1000) {
    return cached.keys[kid] ?? null;
  }
  const res = await fetch(uri);
  if (!res.ok) return null;
  const body = (await res.json()) as { jwks?: { keys: JsonWebKey[] }; keys?: JsonWebKey[] };
  const keys = body.jwks?.keys ?? body.keys ?? [];
  const map: Record<string, JsonWebKey> = {};
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
  const obj = payload as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (k === "_sd" && Array.isArray(v)) {
      for (const digest of v) {
        if (typeof digest === "string") out.add(digest);
      }
    } else if (typeof v === "object") {
      collectSdDigests(v, out);
    }
  }
  return out;
}

// Returns an ArrayBuffer-backed Uint8Array so it's `BufferSource`-typed
// under TypeScript 5.7+'s stricter typings (SharedArrayBuffer-backed
// views are rejected by SubtleCrypto's `verify` signature).
function b64uBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = (4 - (s.length % 4)) % 4;
  const std = (s + "=".repeat(pad)).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(std);
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64uEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
