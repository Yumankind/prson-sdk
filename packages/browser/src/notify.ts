// Website notifications (SignInOptions.notifications): the wallet answers an
// opted-in sign-in with a handle, random per wallet and site, that the site's
// backend uses with POST https://api.prson.net/v1/notify (an API key with
// notify:write). See documentation/SITE_NOTIFICATIONS.md.

/** What a notification handle looks like: `nh_` and 32 random bytes, base64url. */
export const NOTIFY_HANDLE = /^nh_[A-Za-z0-9_-]{43}$/;

/**
 * The handle in the wallet's sign-in envelope, or null when the person didn't
 * tick "Let {site} send you notifications" (or the wallet is older). Anything
 * that isn't a well-formed handle reads as null.
 */
export function notifyHandleFrom(envelope: unknown): string | null {
  if (!envelope || typeof envelope !== "object") return null;
  const value = (envelope as { notifyHandle?: unknown }).notifyHandle;
  return typeof value === "string" && NOTIFY_HANDLE.test(value) ? value : null;
}
