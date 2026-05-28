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

/** Decrypted plaintext envelope — see ARCHITECTURE.md §4.2. */
export type DecryptedEnvelope = {
  v: string;
  msg: "presentation" | "renewal" | "revoke" | "decline";
  issuedAt: number;
  ttlMinutes: number;
  domain: string;
  presentation: string;
  fragments?: unknown[];
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
