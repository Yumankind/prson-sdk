/**
 * Revocation check: IETF Token Status List (draft-ietf-oauth-status-list).
 *
 * Every credential Prson issues carries
 *   status: { status_list: { idx, uri } }
 * and `uri` serves a Status List Token: a JWT (typ statuslist+jwt) signed by
 * the same issuer key as the credential, whose status_list.lst is a
 * base64url, DEFLATE (ZLIB) compressed bitstring (`bits` bits per entry,
 * index 0 in the lowest bits of byte 0). 0 = VALID; anything else (1
 * INVALID, 2 SUSPENDED) means the credential must not be accepted.
 *
 * Lists are cached briefly (default 60 s, never longer than the token's own
 * ttl). When the list can't be fetched or checked, `onUnavailable` decides:
 * "fail-closed" rejects, "fail-open" accepts. The default is closed for
 * verified humans (verification_level 5 or more, or verified_human: true)
 * and open below that.
 */

export type StatusPolicy = "fail-open" | "fail-closed";

type JsonWebKey = import("node:crypto").webcrypto.JsonWebKey;

export type StatusCheckOptions = {
  /** What to do when the status list can't be fetched or verified. Default: closed at level 5+, open below. */
  onUnavailable?: StatusPolicy;
  /** How long a fetched list is reused (seconds, default 60; capped by the token's ttl). */
  cacheSeconds?: number;
  /** The issuer's key for a kid (the same keys that sign credentials). */
  resolveKey: (kid: string) => Promise<JsonWebKey | null>;
  /** Override fetch (tests, proxies). */
  fetch?: (uri: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
  /** Clock override (ms). */
  now?: () => number;
};

export type StatusCheckResult =
  | { ok: true; checked: boolean; unavailable?: string }
  | { ok: false; reason: "vc_revoked" | "status_unavailable"; detail?: string };

type CachedList = { fetchedAt: number; ttlMs: number; exp: number | null; bits: number; list: Uint8Array };
const cache = new Map<string, CachedList>();

/** Tests: forget cached lists. */
export function clearStatusCache(): void {
  cache.clear();
}

/** Whether the credential's claims describe a verified human (where an unknown status fails closed by default). */
export function isStrongCredential(payload: Record<string, unknown>): boolean {
  return payload.verified_human === true || (typeof payload.verification_level === "number" && payload.verification_level >= 5);
}

export async function checkCredentialStatus(payload: Record<string, unknown>, opts: StatusCheckOptions): Promise<StatusCheckResult> {
  const ref = (payload.status as { status_list?: { idx?: unknown; uri?: unknown } } | undefined)?.status_list;
  if (!ref) return { ok: true, checked: false };
  const policy: StatusPolicy = opts.onUnavailable ?? (isStrongCredential(payload) ? "fail-closed" : "fail-open");
  const unavailable = (detail: string): StatusCheckResult =>
    policy === "fail-open" ? { ok: true, checked: false, unavailable: detail } : { ok: false, reason: "status_unavailable", detail };
  const idx = ref.idx;
  const uri = ref.uri;
  if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0 || typeof uri !== "string" || !/^https:\/\//.test(uri)) {
    return { ok: false, reason: "status_unavailable", detail: "malformed status reference" };
  }
  let entry: CachedList;
  try {
    entry = await statusList(uri, opts);
  } catch (e) {
    return unavailable((e as Error).message);
  }
  const bitOffset = idx * entry.bits;
  const byte = entry.list[bitOffset >> 3];
  if (byte === undefined) return unavailable("index outside the list");
  const value = (byte >> (bitOffset & 7)) & ((1 << entry.bits) - 1);
  if (value !== 0) return { ok: false, reason: "vc_revoked", detail: value === 2 ? "suspended" : "invalid" };
  return { ok: true, checked: true };
}

async function statusList(uri: string, opts: StatusCheckOptions): Promise<CachedList> {
  const now = opts.now?.() ?? Date.now();
  const cached = cache.get(uri);
  if (cached && now - cached.fetchedAt < cached.ttlMs && (cached.exp === null || cached.exp * 1000 > now)) return cached;
  const doFetch = opts.fetch ?? ((u: string) => fetch(u, { headers: { Accept: "application/statuslist+jwt" } }));
  const res = await doFetch(uri);
  if (!res.ok) throw new Error(`status list HTTP ${res.status}`);
  const jwt = (await res.text()).trim();
  const [h, p, s] = jwt.split(".");
  if (!h || !p || !s) throw new Error("status list token malformed");
  const header = JSON.parse(utf8(b64uBytes(h))) as { alg?: string; kid?: string; typ?: string };
  const payload = JSON.parse(utf8(b64uBytes(p))) as { sub?: string; exp?: number; ttl?: number; status_list?: { bits?: number; lst?: string } };
  if (header.typ !== "statuslist+jwt" || header.alg !== "RS256" || !header.kid) throw new Error("status list token header");
  const jwk = await opts.resolveKey(header.kid);
  if (!jwk) throw new Error("status list key unknown");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64uBytes(s), new TextEncoder().encode(`${h}.${p}`)))) throw new Error("status list signature");
  if (payload.sub !== uri) throw new Error("status list subject");
  if (typeof payload.exp === "number" && payload.exp * 1000 <= now) throw new Error("status list expired");
  const bits = payload.status_list?.bits;
  if (bits !== 1 && bits !== 2 && bits !== 4 && bits !== 8) throw new Error("status list bits");
  if (typeof payload.status_list?.lst !== "string") throw new Error("status list lst");
  const list = await inflate(b64uBytes(payload.status_list.lst));
  const want = (opts.cacheSeconds ?? 60) * 1000;
  const ttlMs = typeof payload.ttl === "number" ? Math.min(want, payload.ttl * 1000) : want;
  const entry: CachedList = { fetchedAt: now, ttlMs, exp: typeof payload.exp === "number" ? payload.exp : null, bits, list };
  cache.set(uri, entry);
  return entry;
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const utf8 = (b: Uint8Array) => new TextDecoder().decode(b);

function b64uBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = (4 - (s.length % 4)) % 4;
  const bin = atob((s + "=".repeat(pad)).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
