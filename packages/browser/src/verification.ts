/**
 * Show a person a Prson **verification** (an organisation's request made
 * with POST /v1/verifications — prove your age, show your ID, sign this
 * PDF with your verified name) and wait until they answer it.
 *
 * The verification is created by YOUR SERVER with your API key; the key
 * never reaches the browser. Your page gets the `share_url` from your
 * server, and `checkStatus` asks your server for the status (your server
 * calls GET /v1/verifications/{id}, or keeps what the verification.*
 * webhooks told it). On a computer the link shows as a QR code to scan
 * with the phone; on a phone, as a button that opens the Prson app.
 *
 *   const { share_url, id } = await (await fetch("/api/contract/sign", { method: "POST" })).json();
 *   await awaitVerification({
 *     shareUrl: share_url,
 *     title: "Sign the rental agreement",
 *     checkStatus: async (signal) => (await (await fetch(`/api/verifications/${id}`, { signal })).json()).status,
 *   });
 *   // fulfilled: your server downloads the signed PDF (the response's signature.download_path).
 *
 * Resolves with the status once `until` holds (default: "fulfilled");
 * rejects with VerificationClosedError when it was cancelled or expired,
 * and VerificationAbortedError when the person closes the dialog or
 * `signal` aborts.
 */

import { createModalQrMount, renderLoginQr, type LoginQrHandle } from "./qr.js";

export type VerificationStatus = "open" | "partially_fulfilled" | "fulfilled" | "cancelled" | "expired";

export interface AwaitVerificationOptions {
  /** The verification's `share_url`, from your server. */
  shareUrl: string;
  /** Your server's view of the verification's status. Called every `intervalMs`; a throw is retried. */
  checkStatus: (signal: AbortSignal) => Promise<VerificationStatus | string>;
  /** Shown above the code: what the person is asked for (e.g. "Sign the rental agreement"). */
  title?: string;
  /** Where to render; default: a modal over the page (Esc or a click outside closes it). */
  mountInto?: string | HTMLElement;
  /** How often to call `checkStatus`, in ms (default 3000, at least 1000). */
  intervalMs?: number;
  /** Stop after this long (ms) with VerificationAbortedError; default: wait until it closes. */
  timeoutMs?: number;
  /** When to stop waiting (default: status === "fulfilled"). */
  until?: (status: string) => boolean;
  signal?: AbortSignal;
  theme?: "light" | "dark" | "auto";
  /** Force the phone (button) or computer (QR) layout; default: guessed from the pointer. */
  layout?: "phone" | "computer";
}

export class VerificationAbortedError extends Error {
  constructor(message = "The verification dialog was closed") {
    super(message);
    this.name = "VerificationAbortedError";
  }
}

export class VerificationClosedError extends Error {
  constructor(readonly status: "cancelled" | "expired") {
    super(`The verification is ${status}`);
    this.name = "VerificationClosedError";
  }
}

function checkShareUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`shareUrl is not a URL: ${url}`);
  }
  if (parsed.protocol !== "https:") throw new Error("shareUrl must be https:// (the share_url Prson returned)");
  return parsed.toString();
}

function isPhone(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches && window.matchMedia("(max-width: 820px)").matches;
  } catch {
    return false;
  }
}

/** The card: title, the QR (computer) or an "Open in Prson" button (phone), and a status line. */
function renderCard(mount: HTMLElement, o: { url: string; title?: string; phone: boolean; theme: "light" | "dark" | "auto" }) {
  const dark = o.theme === "dark" || (o.theme === "auto" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  const card = document.createElement("div");
  card.setAttribute("data-prson-verification", "1");
  card.style.cssText =
    "box-sizing:border-box;max-width:360px;width:100%;padding:24px;border-radius:16px;font-family:system-ui,-apple-system,sans-serif;text-align:center;" +
    (dark ? "background:#14161b;color:#f2f3f5;" : "background:#fff;color:#14161b;") +
    "box-shadow:0 12px 40px rgba(0,0,0,0.25);";
  if (o.title) {
    const h = document.createElement("div");
    h.style.cssText = "font-size:17px;font-weight:600;margin-bottom:6px;line-height:1.3;";
    h.textContent = o.title;
    card.append(h);
  }
  const hint = document.createElement("div");
  hint.style.cssText = "font-size:14px;opacity:0.75;margin-bottom:16px;line-height:1.4;";
  hint.textContent = o.phone ? "Open the request in the Prson app on this phone." : "Scan with your phone's camera to open it in the Prson app.";
  card.append(hint);

  let qr: LoginQrHandle | null = null;
  if (o.phone) {
    const a = document.createElement("a");
    a.href = o.url;
    a.rel = "noopener";
    a.textContent = "Open in Prson";
    a.style.cssText = "display:inline-block;padding:12px 20px;border-radius:999px;background:#2949b8;color:#fff;font-weight:600;text-decoration:none;font-size:15px;";
    card.append(a);
  } else {
    const qrMount = document.createElement("div");
    qrMount.style.cssText = "display:flex;justify-content:center;margin:4px 0 8px;";
    card.append(qrMount);
    qr = renderLoginQr(o.url, qrMount, o.theme);
    const link = document.createElement("a");
    link.href = o.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "On this device? Open the link";
    link.style.cssText = "display:inline-block;margin-top:4px;font-size:13px;color:inherit;opacity:0.7;";
    card.append(link);
  }
  const status = document.createElement("div");
  status.setAttribute("role", "status");
  status.style.cssText = "font-size:13px;opacity:0.7;margin-top:16px;";
  status.textContent = "Waiting for an answer…";
  card.append(status);
  mount.append(card);
  return {
    setStatus: (s: string) => {
      status.textContent = s === "partially_fulfilled" ? "Partly answered, waiting for the rest…" : "Waiting for an answer…";
    },
    dispose: () => {
      qr?.dispose();
      card.remove();
    },
  };
}

export async function awaitVerification(opts: AwaitVerificationOptions): Promise<{ status: string }> {
  const url = checkShareUrl(opts.shareUrl);
  const interval = Math.max(1000, opts.intervalMs ?? 3000);
  const until = opts.until ?? ((s: string) => s === "fulfilled");
  const controller = new AbortController();
  const abort = (reason: Error) => controller.abort(reason);
  opts.signal?.addEventListener("abort", () => abort(new VerificationAbortedError("Aborted")), { once: true });

  let modal: { mount: HTMLElement; dispose: () => void } | null = null;
  let mount: HTMLElement | null = null;
  if (opts.mountInto) mount = typeof opts.mountInto === "string" ? document.querySelector(opts.mountInto) : opts.mountInto;
  if (!mount) {
    modal = createModalQrMount({ onDismiss: () => abort(new VerificationAbortedError()) });
    mount = modal.mount;
  }
  const card = renderCard(mount, { url, title: opts.title, phone: opts.layout ? opts.layout === "phone" : isPhone(), theme: opts.theme ?? "auto" });
  const timer = opts.timeoutMs ? setTimeout(() => abort(new VerificationAbortedError("Timed out waiting for an answer")), opts.timeoutMs) : null;

  const sleep = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      if (controller.signal.aborted) return reject(controller.signal.reason);
      const t = setTimeout(resolve, ms);
      controller.signal.addEventListener("abort", () => (clearTimeout(t), reject(controller.signal.reason)), { once: true });
    });

  try {
    for (;;) {
      if (controller.signal.aborted) throw controller.signal.reason;
      let status: string | null = null;
      try {
        status = String(await opts.checkStatus(controller.signal));
      } catch (e) {
        if (controller.signal.aborted) throw controller.signal.reason;
        // A failed check (network, your server) is retried at the next tick.
      }
      if (status !== null) {
        if (until(status)) return { status };
        if (status === "cancelled" || status === "expired") throw new VerificationClosedError(status);
        card.setStatus(status);
      }
      await sleep(interval);
    }
  } finally {
    if (timer) clearTimeout(timer);
    card.dispose();
    modal?.dispose();
  }
}
