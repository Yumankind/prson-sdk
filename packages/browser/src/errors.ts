/**
 * Every error `signIn()` rejects with carries a stable `code`, so a site
 * can branch on it instead of matching message text. Messages may change;
 * codes don't (new codes may be added).
 */

export type PrsonLoginErrorCode =
  /** A newer signIn() call, or the person closed the dialog. */
  | "aborted"
  /** The page's Content-Security-Policy blocked a Prson host (PrsonCspError). */
  | "csp_blocked"
  /** The code ran out before anyone approved it. */
  | "expired"
  /** Too many sign-ins from this network; retry shortly. */
  | "rate_limited"
  /** Prson's relay or the phone couldn't be reached. */
  | "network"
  /** The credential failed a check; `reason` says which (verifier reasons, e.g. aud_mismatch). */
  | "presentation_rejected"
  /** The person's verification level is below `required.minVerificationLevel`. */
  | "level_too_low"
  /** `required.uniqueHumanId` was set and no unique-human id came back. */
  | "unique_human_missing"
  /** The phone sent something the SDK doesn't understand. */
  | "protocol"
  /** A signIn() option is wrong (nonce, returnUrl). */
  | "invalid_options"
  /** Anything else; `cause` holds the original error. */
  | "unknown";

export class PrsonLoginError extends Error {
  readonly code: PrsonLoginErrorCode;
  /** For presentation_rejected: the verifier's reason, such as "nonce_mismatch". */
  readonly reason?: string;
  /** For "unknown" (and wrapped errors): the original error. */
  readonly cause?: unknown;
  constructor(code: PrsonLoginErrorCode, message: string, reason?: string, cause?: unknown) {
    super(message);
    this.name = "PrsonLoginError";
    this.code = code;
    if (reason !== undefined) this.reason = reason;
    if (cause !== undefined) this.cause = cause;
  }
}

/** The code for an error from the relay or the connection (signaling closes name a reason). */
export function closedCode(reason: string): PrsonLoginErrorCode {
  return /expir/i.test(reason) ? "expired" : "network";
}

/** Any error as a PrsonLoginError: a failed fetch is "network", anything else "unknown" (the original is its cause). */
export function asLoginError(e: unknown): PrsonLoginError {
  if (e instanceof PrsonLoginError) return e;
  const message = e instanceof Error ? e.message : String(e);
  const code: PrsonLoginErrorCode = /Failed to fetch|NetworkError|Load failed/i.test(message) ? "network" : "unknown";
  return new PrsonLoginError(code, message, undefined, e);
}
