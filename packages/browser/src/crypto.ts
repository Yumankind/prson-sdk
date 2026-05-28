/**
 * Browser-side crypto for the login SDK:
 *
 *   • generateEphemeralKeypair  — X25519 keypair for the duration of
 *     one sign-in. Held in memory; discarded on session.close() or page
 *     unload. The public key is the value the wallet boxes its envelope
 *     to.
 *
 *   • decryptEnvelope            — open the wallet's NaCl `box` ciphertext
 *     and parse the resulting JSON.
 *
 * Uses `@stablelib/nacl` for the box / open primitives — a reviewed
 * pure-JS implementation that runs in every browser without WebCrypto
 * dependency gaps (Web Crypto doesn't ship X25519 in all engines).
 */
import { openBox } from "@stablelib/nacl";
import { generateKeyPair } from "@stablelib/x25519";
import { randomBytes } from "@stablelib/random";
import { decodeURLSafe as b64uDecode, encodeURLSafe as b64uEncode } from "@stablelib/base64";

export type EphemeralKeys = {
  /** The X25519 secret key (32 bytes). Never serialised; never logged. */
  secretKey: Uint8Array;
  /** The matching public key (32 bytes). */
  publicKey: Uint8Array;
  /** Base64url-encoded public key for use in QRs + the verifier request. */
  publicKeyB64u: string;
};

export async function generateEphemeralKeypair(): Promise<EphemeralKeys> {
  // @stablelib's generateKeyPair pulls entropy from a CSPRNG (window.crypto
  // via @stablelib/random). For environments without crypto.getRandomValues
  // (none we support), this would throw — that's correct behaviour.
  void randomBytes(1); // touch the entropy source so a misconfigured browser fails fast
  const kp = generateKeyPair();
  return {
    secretKey: kp.secretKey,
    publicKey: kp.publicKey,
    publicKeyB64u: stripPad(b64uEncode(kp.publicKey)),
  };
}

/** Wire shape (matches what the wallet emits — see ARCHITECTURE.md §4.2). */
export type EncryptedEnvelope = {
  /** Wallet's per-message X25519 pk, base64url. */
  ephPk: string;
  /** 24-byte nonce, base64url. */
  nonce24: string;
  /** Boxed ciphertext + Poly1305 tag, base64url. */
  ct: string;
};

/** Decrypted plaintext envelope — see ARCHITECTURE.md §4.2.
 *
 * Three of the `msg` types are post-sign-in lifecycle events
 * (`claim-update`, `display-update`, `credential-revoked`) per the
 * roadmap §1. They flow on the same WebRTC channel as the initial
 * `presentation` + renewals, framed with the same NaCl-boxed
 * envelope so the wallet doesn't need a separate transport for live
 * profile / claim updates.
 *
 * Important: any event whose payload includes claim VALUES (today
 * only `claim-update`) MUST carry a `presentation` field, and the
 * SDK MUST re-verify that presentation before firing any listener.
 * Bare claim deltas without a fresh SD-JWT-VC backing them are NOT
 * trusted — see ROADMAP §1.3 and SECURITY.md §7.
 */
export type DecryptedEnvelope = {
  v: string;
  msg:
    | "presentation"
    | "renewal"
    | "revoke"
    | "decline"
    | "claim-update"
    | "display-update"
    | "credential-revoked";
  issuedAt: number;
  ttlMinutes?: number;
  domain?: string;

  /** Present for `presentation`, `renewal`, and `claim-update`. */
  presentation?: string;
  fragments?: unknown[];

  /** `claim-update` body: per-claim **name-only** delta. The
   *  wallet MUST NOT include claim values here — the SDK ignores
   *  the delta entirely and recomputes from the re-verified VC
   *  for correctness, and emits name-only events to keep raw
   *  claim values out of telemetry/log surfaces. The wire field
   *  is kept (typed as name-only) so future wallets can hint at
   *  what changed without an SDK bump, but the SDK never trusts
   *  the hint as authoritative. */
  delta?: {
    added?: string[];
    removed?: string[];
    updated?: string[];
  };

  /** `display-update` body. Either field independently optional;
   *  absent means "no change". Pass `null` to clear. No crypto
   *  re-verify required — display-only hints for the host UI. */
  displayName?: string | null;
  avatar?: { url: string; hash: string } | null;

  /** `credential-revoked` body. Closes the session with the
   *  matching ExpiryReason. */
  reason?: "alias_transferred" | "user_revoked" | "key_compromised";
};

export async function decryptEnvelope(
  raw: string,
  keys: EphemeralKeys,
): Promise<DecryptedEnvelope> {
  let parsed: EncryptedEnvelope;
  try {
    parsed = JSON.parse(raw) as EncryptedEnvelope;
  } catch {
    throw new Error("decryptEnvelope: not a JSON envelope");
  }
  if (typeof parsed.ephPk !== "string" || typeof parsed.nonce24 !== "string" || typeof parsed.ct !== "string") {
    throw new Error("decryptEnvelope: missing required fields {ephPk, nonce24, ct}");
  }
  const ephPk = b64uDecode(addPad(parsed.ephPk));
  const nonce = b64uDecode(addPad(parsed.nonce24));
  const ct = b64uDecode(addPad(parsed.ct));
  if (ephPk.length !== 32) throw new Error("decryptEnvelope: bad ephPk length");
  if (nonce.length !== 24) throw new Error("decryptEnvelope: bad nonce length");
  // NaCl `openBox` returns null on bad ciphertext / wrong key — never
  // throws. We must check + raise ourselves.
  const pt = openBox(ephPk, keys.secretKey, nonce, ct);
  if (!pt) throw new Error("decryptEnvelope: authentication failed (wrong key or tampered ciphertext)");
  try {
    return JSON.parse(new TextDecoder().decode(pt)) as DecryptedEnvelope;
  } catch {
    throw new Error("decryptEnvelope: decrypted but not JSON");
  }
}

function stripPad(s: string): string {
  return s.replace(/=+$/, "");
}

function addPad(s: string): string {
  const mod = s.length % 4;
  return mod === 0 ? s : s + "=".repeat(4 - mod);
}
