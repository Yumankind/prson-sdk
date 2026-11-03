/**
 * Prson's signed proof verdicts ("prson-truth-verdict/2").
 *
 * Prson countersigns each proof's verdict as a canonical JSON envelope
 * (RS256: RSASSA-PKCS1-v1_5 with SHA-256, base64 signature over the UTF-8
 * bytes of the sorted-keys JSON). From v2 the envelope also commits to what
 * was disclosed: one `{kind, id, digest}` per disclosed fact, property value
 * or document field, where
 *
 *   digest = base64url(SHA-256(canonicalJson([salt, kind, id, value])))
 *
 * The recipient gets each `[salt, kind, id, value]` beside the envelope
 * (SD-JWT style), so whoever later holds those values can prove offline
 * that Prson vouched for exactly them. The salt is 16 random bytes, so the
 * envelope alone reveals nothing guessable.
 *
 * node:crypto only (no `jose`), so this module runs on its own.
 */
import { createHash, createPublicKey, createVerify, type JsonWebKey, type KeyObject } from "node:crypto";

export const VERDICT_SCOPE_V1 = "prson-truth-verdict/1";
export const VERDICT_SCOPE_V2 = "prson-truth-verdict/2";

export type VerdictDisclosureKind = "fact" | "property" | "document_field";

/** `[salt, kind, id, value]`, as the API returns it beside the envelope. */
export type VerdictDisclosure = [salt: string, kind: VerdictDisclosureKind | string, id: string, value: unknown];

export type VerdictEnvelope = {
  scope: string;
  proofId: string;
  type?: string | null;
  captureHash?: string | null;
  artefactHashes?: Record<string, string> | null;
  challengeId?: string | null;
  slotId?: string | null;
  signerIdentityId?: string | null;
  level: string;
  verifiedAt: string | null;
  /** v2 only: one commitment per disclosed item. */
  disclosures?: Array<{ kind: string; id: string; digest: string }>;
  [k: string]: unknown;
};

/** A public key: SPKI PEM, a JWK or a node KeyObject. */
export type VerdictPublicKey = string | JsonWebKey | KeyObject;

export type VerifyVerdictOptions = {
  /** One key to check against. */
  publicKey?: VerdictPublicKey;
  /** Prson's keyring (GET /v1/company/public-key `verificationKeys`, or a JWKS's `keys`); `kid` is tried first. */
  keys?: Array<{ kid?: string | null; publicKey: VerdictPublicKey }>;
  /** The seal's `kid` (pins the matching key first). */
  kid?: string | null;
};

export type VerifiedDisclosure = {
  kind: string;
  id: string;
  value: unknown;
  verified: boolean;
  reason?: "malformed" | "not-covered" | "digest-mismatch" | "signature-invalid";
};

export type VerifyVerdictResult = {
  /** The signature checks and every disclosure is covered by the envelope. */
  ok: boolean;
  signatureValid: boolean;
  version: 1 | 2 | null;
  disclosures: VerifiedDisclosure[];
  reason?: "malformed" | "unsupported-scope" | "no-key" | "signature-invalid" | "disclosure-not-verified";
};

/** Sorted-keys JSON, byte-identical to the server's `canonicalJson`. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return "{" + Object.keys(rec).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(rec[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

/** The digest a v2 envelope carries for `[salt, kind, id, value]`. */
export function verdictDisclosureDigest(disclosure: VerdictDisclosure): string {
  return createHash("sha256").update(canonicalJson(disclosure), "utf8").digest("base64url");
}

function toKey(k: VerdictPublicKey): KeyObject {
  if (typeof k === "string") return createPublicKey(k);
  if ("type" in k && (k as KeyObject).type === "public" && typeof (k as KeyObject).export === "function") return k as KeyObject;
  return createPublicKey({ key: k as JsonWebKey, format: "jwk" });
}

function signatureChecks(envelope: unknown, signature: string, opts: VerifyVerdictOptions): boolean | null {
  const ring = [...(opts.publicKey ? [{ kid: opts.kid ?? null, publicKey: opts.publicKey }] : []), ...(opts.keys ?? [])];
  if (ring.length === 0) return null;
  const ordered = [...ring.filter((k) => opts.kid && k.kid === opts.kid), ...ring.filter((k) => !opts.kid || k.kid !== opts.kid)];
  const sig = Buffer.from(signature, "base64");
  const message = canonicalJson(envelope);
  for (const k of ordered) {
    try {
      const v = createVerify("RSA-SHA256");
      v.update(message, "utf8");
      v.end();
      if (v.verify(toKey(k.publicKey), sig)) return true;
    } catch {
      // An unreadable key or a signature of the wrong size: try the next key.
    }
  }
  return false;
}

/**
 * Check Prson's signature on a verdict envelope and each disclosed value
 * against it. A disclosure verifies only when the envelope is v2, the
 * signature checks and the envelope carries an entry with the same kind, id
 * and recomputed digest. A v1 envelope (made before verdicts covered values)
 * can still have a valid signature, but no disclosure verifies against it
 * (`reason: "not-covered"`), so `ok` is false whenever values were given.
 */
export function verifyVerdict(
  envelope: VerdictEnvelope | unknown,
  signature: string,
  disclosures: VerdictDisclosure[] | unknown[] | null | undefined,
  opts: VerifyVerdictOptions,
): VerifyVerdictResult {
  const list = Array.isArray(disclosures) ? disclosures : [];
  const shaped = list.map((d): VerifiedDisclosure & { raw: unknown } => {
    if (!Array.isArray(d) || d.length !== 4 || typeof d[0] !== "string" || typeof d[1] !== "string" || typeof d[2] !== "string") {
      return { kind: "", id: "", value: null, verified: false, reason: "malformed", raw: d };
    }
    return { kind: d[1], id: d[2], value: d[3], verified: false, raw: d };
  });
  const strip = (xs: typeof shaped): VerifiedDisclosure[] => xs.map(({ raw: _raw, ...rest }) => rest);
  const env = envelope as VerdictEnvelope | null;
  if (!env || typeof env !== "object" || typeof signature !== "string" || !signature) {
    return { ok: false, signatureValid: false, version: null, disclosures: strip(shaped), reason: "malformed" };
  }
  const version = env.scope === VERDICT_SCOPE_V2 ? 2 : env.scope === VERDICT_SCOPE_V1 ? 1 : null;
  if (version === null) return { ok: false, signatureValid: false, version, disclosures: strip(shaped), reason: "unsupported-scope" };
  const sigOk = signatureChecks(env, signature, opts);
  if (sigOk === null) return { ok: false, signatureValid: false, version, disclosures: strip(shaped), reason: "no-key" };
  const entries = version === 2 && Array.isArray(env.disclosures) ? env.disclosures : [];
  for (const d of shaped) {
    if (d.reason) continue;
    if (!sigOk) {
      d.reason = "signature-invalid";
      continue;
    }
    if (version !== 2) {
      d.reason = "not-covered";
      continue;
    }
    const digest = verdictDisclosureDigest(d.raw as VerdictDisclosure);
    const sameItem = entries.filter((e) => e && e.kind === d.kind && e.id === d.id);
    if (sameItem.some((e) => e.digest === digest)) d.verified = true;
    else d.reason = sameItem.length ? "digest-mismatch" : "not-covered";
  }
  const out = strip(shaped);
  if (!sigOk) return { ok: false, signatureValid: false, version, disclosures: out, reason: "signature-invalid" };
  const allOk = out.every((d) => d.verified);
  return { ok: allOk, signatureValid: true, version, disclosures: out, ...(allOk ? {} : { reason: "disclosure-not-verified" as const }) };
}
