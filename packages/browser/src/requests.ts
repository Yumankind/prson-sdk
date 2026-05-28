/**
 * Verifier → wallet REQUEST channel.
 *
 * After sign-in the host site can ask the wallet for things that
 * weren't part of the initial disclosure (a specific claim value, a
 * predicate check, a document presence assertion, a document
 * signature, a free-form input typed on the phone). Each request
 * carries a UUID; the wallet replies with a matching `response`
 * envelope whose `requestId` references it.
 *
 * Three protocol invariants the wallet enforces:
 *
 *   * **At most one request per second** — inter-arrival throttle on
 *     the wallet side. Inbound requests that violate this are silently
 *     dropped (no response sent); the browser SDK's per-call timeout
 *     surfaces them as `error: "timeout"`.
 *
 *   * **At most five outstanding requests** in the wallet's queue.
 *     Once five drawers are open, further incoming requests are
 *     ignored on the floor.
 *
 *   * **Requests fire ONLY while a web session is active.** No
 *     background requests, no pre-sign-in requests. The session's
 *     transport going away invalidates every pending request with
 *     `error: "no-active-session"`.
 *
 * Browser SDK shape (this file): public types + the in-flight
 * controller that pairs outbound requests with their wallet replies.
 * The session's `_sendToWallet` is the cipher path.
 */

import type { DecryptedEnvelope } from "./crypto.js";

// ─── Public request shapes ────────────────────────────────────────

/**
 * Free-form text/numeric input typed on the phone — the "kiosk
 * companion" use case. Mirrors a subset of the HTML input element
 * so the wallet UI can pick a sensible keyboard / validator.
 *
 * `select` is included to cover `<select>` elements: the wallet UI
 * renders an options picker (radio-style on phone) and returns the
 * chosen option's `value`.
 */
export type InputType =
  | "text"
  | "search"
  | "email"
  | "tel"
  | "url"
  | "number"
  | "password"
  | "select";

/** One choice in a `select` field. */
export interface InputOption {
  /** Wire value — what the wallet returns and the host fills. */
  value: string;
  /** Display label shown in the wallet picker. Defaults to `value`. */
  label?: string;
}

/**
 * One field inside a multi-input `input-form` request. Same surface
 * as a single `kind: "input"` request, plus an optional `name` (used
 * as the reply key) and a `defaultValue` (pre-fill).
 *
 * Two shapes — the discriminator is `inputType`:
 *
 *   * Text/numeric inputs: `text` | `search` | `email` | `tel` |
 *     `url` | `number` | `password` — validation knobs match the
 *     HTML5 attribute set the host can read off a DOM `<input>`.
 *
 *   * Select picker: `inputType: "select"` requires `options` and
 *     ignores the validation knobs that don't apply (`pattern`,
 *     `minLength`, `maxLength`).
 */
export type InputFormField =
  | {
      name: string;
      inputType: Exclude<InputType, "select">;
      label: string;
      placeholder?: string;
      defaultValue?: string;
      minLength?: number;
      maxLength?: number;
      min?: number;
      max?: number;
      pattern?: string;
      required?: boolean;
    }
  | {
      name: string;
      inputType: "select";
      label: string;
      options: InputOption[];
      defaultValue?: string;
      required?: boolean;
    };

export type LoginRequest =
  /**
   * Ask the wallet to reveal the raw value of a single claim. Used
   * by host sites that want a stale claim refreshed without a
   * full re-sign-in — e.g. "what's your current verification
   * level?". The wallet prompts the user before answering.
   */
  | {
      kind: "claim-value";
      name: string;
      /** Human-readable reason shown in the wallet drawer. */
      reason?: string;
    }

  /**
   * Predicate check against a fragment the wallet has signed.
   * Returns the matching signed fragment so the verifier can
   * re-verify the signature server-side.
   */
  | {
      kind: "fragment-check";
      fragmentName: string;
      reason?: string;
    }

  /**
   * Ask the wallet whether a verified document of the given shape
   * is present. The user can also pick a document; if none
   * matches, the wallet may offer to scan one via NFC (if the
   * device is compatible). Reply carries either the document's
   * notarised metadata or an error.
   */
  | {
      kind: "document-presence";
      /** Filter — `"passport"`, `"national_id"`, etc. */
      type?: string;
      /** ISO-3 country code, optional. */
      country?: string;
      reason?: string;
    }

  /**
   * Document signing — the host hands the wallet either the raw
   * bytes (for tiny files) or a short-lived upload URL. The wallet
   * signs with the identity's PAdES-bound EC key (see
   * `mobile-app/prson_app/docs/identity_pdf_signing.md`).
   */
  | {
      kind: "document-sign";
      document:
        | { bytes: Uint8Array }
        | { uploadUrl: string; size?: number; sha256?: string };
      visibleCue?: string;
      reason?: string;
    }

  /**
   * Generic single input request — kiosk pattern. The wallet shows
   * a keyboard sized to the type + the constraints, returns the
   * typed value. No notary signature — the host trusts the
   * channel + the user.
   *
   * For `inputType: "select"`, supply `options`. The wallet
   * renders a radio-style picker on the phone and the reply's
   * `value` is the chosen option's `value` string.
   */
  | {
      kind: "input";
      inputType: InputType;
      label: string;
      placeholder?: string;
      defaultValue?: string;
      /** HTML5-style validation constraints — wallet enforces. */
      minLength?: number;
      maxLength?: number;
      /** For `inputType: "number"`. */
      min?: number;
      max?: number;
      /** Regex; wallet uses to gate the submit button. */
      pattern?: string;
      required?: boolean;
      /** Required when `inputType === "select"`. */
      options?: InputOption[];
      reason?: string;
    }

  /**
   * Multi-input form — one wallet drawer, prev/next/send
   * navigation, fills every field at once when the user taps
   * Send. The reply's `value` is `Record<fieldName, string>`.
   *
   * Drives the `session.bindForm(...)` helper, which walks a
   * `<form>` / container element and synthesises one of these
   * requests from the DOM. The host can also build them by
   * hand — useful for verifier-side flows where the inputs are
   * decided at runtime rather than rendered on the page.
   */
  | {
      kind: "input-form";
      fields: InputFormField[];
      /** Label on the final "Send" button. Defaults to "Send". */
      submitLabel?: string;
      reason?: string;
    };

export type LoginResponse =
  /** Success — `value` shape depends on the request kind. */
  | { ok: true; value: unknown }
  /** Failure — `error` is a short machine-readable code. */
  | {
      ok: false;
      error:
        | "declined"
        | "not-present"
        | "expired"
        | "rate-limited"
        | "queue-full"
        | "no-active-session"
        | "timeout"
        | "session-closed"
        | "unsupported"
        | string;
    };

export interface RequestOptions {
  /**
   * Hard deadline for the wallet reply. Default 60 s — generous
   * because the wallet drawer is on the user's phone and they may
   * need to scan an NFC document. Callers expecting a fast reply
   * (e.g. kiosk text input) can tighten this.
   */
  timeoutMs?: number;
}

// ─── In-flight controller ─────────────────────────────────────────

interface Pending {
  requestId: string;
  resolve: (r: LoginResponse) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Pairs outbound `request` envelopes with their matching
 * `response` envelopes by UUID. Held privately on a
 * `PrsonLoginSession`; not part of the public surface.
 */
export class RequestController {
  private _pending = new Map<string, Pending>();
  private _closed = false;

  /**
   * Wire up a new outbound request. Returns the requestId to put in
   * the envelope + a `promise` that resolves when the wallet replies
   * (or times out / the session closes).
   */
  enqueue(timeoutMs: number): { requestId: string; promise: Promise<LoginResponse> } {
    const requestId = newUuid();
    const promise = new Promise<LoginResponse>((resolve) => {
      if (this._closed) {
        resolve({ ok: false, error: "session-closed" });
        return;
      }
      const entry: Pending = {
        requestId,
        resolve,
        timer: setTimeout(() => {
          const p = this._pending.get(requestId);
          if (!p) return;
          this._pending.delete(requestId);
          resolve({ ok: false, error: "timeout" });
        }, timeoutMs),
      };
      this._pending.set(requestId, entry);
    });
    return { requestId, promise };
  }

  /** Resolve a pending request when a wallet `response` envelope arrives. */
  resolve(envelope: DecryptedEnvelope): void {
    if (envelope.msg !== "response") return;
    const requestId = envelope.requestId;
    if (!requestId) return;
    const entry = this._pending.get(requestId);
    if (!entry) return; // unknown id — late reply after timeout, ignore
    this._pending.delete(requestId);
    if (entry.timer) clearTimeout(entry.timer);
    if (envelope.error) {
      entry.resolve({ ok: false, error: envelope.error });
    } else {
      entry.resolve({ ok: true, value: envelope.result });
    }
  }

  /**
   * Reject every in-flight request with the given reason. Typically
   * called with `"session-closed"` from session teardown.
   */
  closeAll(reason: string): void {
    if (this._closed) return;
    this._closed = true;
    for (const entry of this._pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve({ ok: false, error: reason });
    }
    this._pending.clear();
  }
}

/**
 * RFC-4122 v4 UUID via `crypto.randomUUID` when present, else a
 * `getRandomValues`-based fallback for older browsers. The wire
 * carries the canonical hex-with-dashes form.
 */
function newUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  // version + variant bits per RFC 4122
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
