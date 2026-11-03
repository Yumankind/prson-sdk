// Website notifications, server side (documentation/SITE_NOTIFICATIONS.md).
//
// When the site signed in with `signIn({ notifications: true })` and the
// person ticked "Let {site} send you notifications", the browser SDK's
// `SignInResult.notifications.handle` carries a handle for that person at the
// site. Post it to your backend beside the presentation; read it there with
// `readNotifyHandle`, keep it with the account, and send with
// `sendNotification` (an API key with notify:write, for an app whose
// registered domains include the sign-in domain). The handle isn't inside the
// signed presentation: accept it only on the request that also carried a
// presentation you verified, and store it on that account.

/** `nh_` and 32 random bytes, base64url. */
export const NOTIFY_HANDLE = /^nh_[A-Za-z0-9_-]{43}$/;

/**
 * The handle from what your page posted: the SignInResult (or its
 * `notifications`), or the handle itself. null when there's none or it is
 * malformed.
 */
export function readNotifyHandle(value: unknown): string | null {
  let v: unknown = value;
  if (v && typeof v === "object" && "notifications" in v) v = (v as { notifications?: unknown }).notifications;
  if (v && typeof v === "object" && "handle" in v) v = (v as { handle?: unknown }).handle;
  return typeof v === "string" && NOTIFY_HANDLE.test(v) ? v : null;
}

export type SendNotificationOptions = {
  /** An API key with notify:write. */
  apiKey: string;
  handle: string;
  /** Plain text, up to 60 characters. Shown after your domain: "{domain}: {title}". */
  title: string;
  /** Plain text, up to 180 characters. */
  body: string;
  /** Optional https link on exactly the domain the person signed in to; the app asks before opening it. */
  url?: string;
  /** Default https://api.prson.net. */
  apiBase?: string;
  fetch?: (input: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; json(): Promise<unknown> }>;
};

export type SendNotificationResult =
  | { ok: true; id: string; status: number }
  /**
   * `revoked` (410): the person turned your notifications off; delete the
   * handle and don't send again. Others: `error` is the API's code
   * (handle_rate_limited, domain_not_registered, insufficient_balance…).
   */
  | { ok: false; status: number; error: string; message?: string; revoked: boolean };

/** POST /v1/notify. Never throws for an API refusal; network errors propagate. */
export async function sendNotification(opts: SendNotificationOptions): Promise<SendNotificationResult> {
  const doFetch = opts.fetch ?? (globalThis.fetch as unknown as NonNullable<SendNotificationOptions["fetch"]>);
  const base = (opts.apiBase ?? "https://api.prson.net").replace(/\/+$/, "");
  const res = await doFetch(`${base}/v1/notify`, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ handle: opts.handle, title: opts.title, body: opts.body, ...(opts.url ? { url: opts.url } : {}) }),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: unknown; error?: unknown; message?: unknown };
  if (res.status === 202 && typeof json.id === "string") return { ok: true, id: json.id, status: res.status };
  return {
    ok: false,
    status: res.status,
    error: typeof json.error === "string" ? json.error : `http_${res.status}`,
    ...(typeof json.message === "string" ? { message: json.message } : {}),
    revoked: res.status === 410,
  };
}
