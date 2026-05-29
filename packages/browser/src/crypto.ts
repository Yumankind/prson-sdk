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
import { box, openBox } from "@stablelib/nacl";
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
    | "credential-revoked"
    | "response"
    | "mouse-update"
    | "nav"
    | "value"
    | "logout"
    /**
     * Browser→wallet pause-state notification. Fired on
     * `window.blur` / `window.focus` so the wallet's mouse
     * controller can show "Remote control paused" while the page
     * is in the background. Body: `paused: boolean`.
     */
    | "control-status"
    /**
     * Browser→wallet "I'm going away" signal. Fired synchronously
     * from `window.pagehide` (refresh, tab close, navigation)
     * before the transport collapses, so the wallet can close the
     * session immediately instead of waiting for the slower
     * `peer-gone` / WS-close pathway. Body: `reason: string`
     * (free-form short code, currently always `"page_unload"`).
     */
    | "browser-revoke"
    /** Transport-layer reliability primitive: the peer's confirmation
     *  that the envelope with id [ackOf] was received. The session
     *  layer auto-emits these for inbound messages carrying an `id`
     *  (other than ping / pong / ack themselves) and resolves
     *  pending-ack promises on the sender side. See session.ts. */
    | "ack"
    /** Liveness probe. Sender keeps a fresh `id` per ping and times
     *  the matching pong to derive RTT. The receiver echoes as
     *  `pong` with `ackOf` set to the ping's `id`. */
    | "ping"
    /** Liveness echo. `ackOf` references the ping's id; `recvTs`
     *  is the peer's wall-clock receipt time. Recipient computes
     *  RTT = now − sendTs cached against [ackOf]. */
    | "pong";
  issuedAt: number;
  ttlMinutes?: number;
  domain?: string;

  /** Transport-layer envelope id (UUID v4). Present on every wire
   *  message that is ack-tracked or dedupe-tracked; absent on
   *  mouse-update (high-frequency broadcast where loss is OK) and
   *  on the protocol primitives `ack` / `pong` (which carry
   *  [ackOf] instead). The receiver dedupes by this id; the sender
   *  retransmits until the matching [ack] arrives. */
  id?: string;

  /** Reference to the originating envelope's [id]. Set on `ack`,
   *  `pong`, and `response` envelopes. */
  ackOf?: string;

  /** Ping send-time wall-clock (epoch ms). The pong copies this
   *  verbatim so the sender doesn't need to maintain a separate
   *  ts cache for an RTT calculation. */
  ts?: number;

  /** Pong-only: the responder's wall-clock receipt time (epoch ms).
   *  Useful for one-way delay estimates if the host wants finer
   *  diagnostics than RTT alone. */
  recvTs?: number;

  /** Present for `presentation`, `renewal`, and `claim-update`. */
  presentation?: string;
  fragments?: unknown[];

  /**
   * Wallet's session-long X25519 public key (base64url, 32 bytes).
   * Present only in the INITIAL `presentation` envelope at sign-in
   * (and on `renewal` if the wallet rotates its session key). The
   * browser SDK extracts + caches this on the session so subsequent
   * outbound `request` envelopes can NaCl-box to it. Without this
   * the browser→wallet direction has no destination key and the
   * request channel can't open.
   */
  walletSessionPk?: string;

  /**
   * User's preferred UI language as a BCP-47 language tag (e.g.
   * `"en"`, `"pt-PT"`, `"fr-CA"`). The wallet sets this from the
   * device's active locale on the initial `presentation` envelope
   * and may rotate it on `renewal` if the device language changes
   * mid-session. The host site can read it via
   * `session.preferredLanguage` to localise its UI without an
   * extra round-trip.
   *
   * Same convention applies to the `displayName` + `avatar` fields
   * below: they originated as the `display-update` envelope body,
   * but the wallet stamps them onto the initial `presentation`
   * envelope too so the host has them on first paint without a
   * separate round-trip.
   */
  preferredLanguage?: string;

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

  /** `response` body. The wallet's reply to an earlier outbound
   *  `request` envelope. Paired by `requestId` (RFC-4122 v4 UUID,
   *  echoed verbatim from the request). Either `result` (success
   *  payload, kind-dependent shape) or `error` (short string code)
   *  is set; both being absent is treated as `error: "unsupported"`. */
  requestId?: string;
  result?: unknown;
  error?: string;

  /**
   * `mouse-update` body. Streamed continuously by the wallet while
   * a `kind: "mouse"` drawer is open, paired by `requestId` to the
   * originating request. The browser SDK's `bindMouse` helper
   * consumes these and applies them to a CSS-positioned virtual
   * cursor on the page.
   *
   * Coordinates are deltas — pixels relative to the previous
   * position — rather than absolute, so phone resolution and page
   * resolution don't need to match. `event` distinguishes
   * pointer-motion frames (`move`) from discrete actions
   * (`click` / `double-click` / `scroll`); `scroll.dy` is positive
   * for downward scroll, matching `WheelEvent.deltaY`.
   */
  mouse?: {
    /**
     * Pointer-stream events.
     *
     *   * `move` / `click` / `double-click` / `scroll` — pointer
     *     events that move the on-page cursor or fire synthetic
     *     mouse events.
     *   * `begin` / `end` — wallet-side stream lifecycle markers
     *     for the pre-grant flow (`SignInOptions.mouseControl`).
     *     Subscribers ignore them as no-op pointer events.
     *   * `hide` / `show` — visibility toggles. The wallet emits
     *     `hide` when the user lifts the phone into a non-pointing
     *     pose (gravity-based pose detector) and re-emits `show`
     *     when wand pose returns. The browser pulls the cursor
     *     off the page on `hide` AND surfaces a "point your phone
     *     at the screen" hint with a soft blue glow on the
     *     viewport edge.
     */
    event:
      | "move"
      | "click"
      | "double-click"
      | "scroll"
      | "begin"
      | "end"
      | "show"
      | "hide";
    dx?: number;
    dy?: number;
    /** Active mode at the time of the event (the wallet drawer can
     *  toggle mid-session). */
    mode?: "touch" | "magic";
  };

  /**
   * `control-status` body. Browser-emitted; the wallet listens via
   * `LoginSession.inbound` and dims its controller surface while
   * `paused: true`. Fired on `window.blur` / `window.focus` so the
   * user can see, on the phone, that the page is no longer
   * accepting their cursor input.
   */
  paused?: boolean;

  /**
   * `nav` body — wallet's remote-navigation command. Sent when the
   * user taps Prev / Next / Submit on the persistent banner drawer.
   *
   *   * `"prev"` / `"next"` — move DOM focus to the previous /
   *      next tabbable input on the page. Semantically equivalent
   *      to Shift+Tab / Tab. SDK fires the matching `focus` event
   *      on the new element so reactive UIs pick up the move.
   *   * `"submit"` — fire `requestSubmit()` on the closest enclosing
   *      `<form>` of the currently focused element. Semantically
   *      equivalent to Enter.
   *
   * Only meaningful when the verifier opted in to
   * `remoteNavigation: true` at sign-in time AND the SDK side called
   * `enableRemoteNavigation(session)`.
   */
  action?: "prev" | "next" | "submit";

  /**
   * `value` body — wallet's edit of the currently-focused input. The
   * SDK applies it via `el.value = ...` + an `input` / `change`
   * event pair. The wallet streams these on every keystroke so the
   * page updates live.
   *
   * Empty string is a valid "clear the field" message and is
   * propagated as-is. A `null` `value` means "no change" — the SDK
   * ignores it; used by the wallet to ack a focus push without
   * actually editing.
   */
  value?: string | null;
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

/**
 * Box a JSON-serialisable [plaintext] to the wallet's session X25519
 * public key. Mirror of the wallet's `LoginEnvelope.encryptToBrowser`
 * primitive (NaCl `box`, XSalsa20-Poly1305, fresh per-message
 * ephemeral keypair + 24-byte nonce) — the wallet decrypts with its
 * stored session secret. Returns the same JSON-encoded envelope
 * shape the browser already RECEIVES from the wallet:
 *
 *     { ephPk: <base64url>, nonce24: <base64url>, ct: <base64url> }
 *
 * The fresh per-message X25519 keypair gives per-message forward
 * secrecy: a snapshot of the wallet's session secret only decrypts
 * messages already-on-the-wire, not future ones.
 *
 * [walletSessionPkB64u] is what the wallet stamped into the initial
 * `presentation` envelope's `walletSessionPk` field. The browser SDK
 * stores it on the session at sign-in time and re-uses for every
 * outbound boxed message.
 */
export function boxToWallet(
  walletSessionPkB64u: string,
  plaintext: string,
): string {
  const recipientPk = b64uDecode(addPad(walletSessionPkB64u));
  if (recipientPk.length !== 32) {
    throw new Error("boxToWallet: bad walletSessionPk length");
  }
  const ephemeral = generateKeyPair();
  const nonce = randomBytes(24);
  const pt = new TextEncoder().encode(plaintext);
  // `@stablelib/nacl` box signature is
  //   box(theirPublicKey, mySecretKey, nonce, data)
  // — RECIPIENT pk first, SENDER sk second. Mirror of `openBox` (which
  // we already call correctly in `decryptEnvelope`). An earlier draft
  // had these swapped, producing a junk shared key that PineNaCl's
  // `Box.decrypt` could never match — every browser→wallet envelope
  // failed Poly1305 authentication on the wallet side. Keep the
  // argument names explicit at the call site so the bug can't recur.
  const ct = box(
    /* theirPublicKey */ recipientPk,
    /* mySecretKey   */ ephemeral.secretKey,
    nonce,
    pt,
  );
  return JSON.stringify({
    ephPk: stripPad(b64uEncode(ephemeral.publicKey)),
    nonce24: stripPad(b64uEncode(nonce)),
    ct: stripPad(b64uEncode(ct)),
  });
}
