/**
 * Content-Security-Policy help.
 *
 * A page whose CSP doesn't allow Prson's hosts sees a plain "Failed to
 * fetch" or a WebSocket error. While a sign-in runs, the SDK listens for
 * the browser's `securitypolicyviolation` events; when one names a Prson
 * host, the failure is reported as a `PrsonCspError` that says which
 * directive blocked what and which sources to add.
 */
import { PrsonLoginError } from "./errors.js";

/** Hosts the browser SDK talks to in production (see the README's CSP section). */
export const PRSON_CONNECT_SRC = [
  "https://signaling.prson.net",
  "wss://signaling.prson.net",
  "https://app.prson.net",
  "https://api.prson.net",
] as const;

/** Thrown by `signIn()` when the page's Content-Security-Policy blocked Prson. */
export class PrsonCspError extends PrsonLoginError {
  readonly directive: string;
  readonly blockedUri: string;
  readonly allow: string[];
  constructor(directive: string, blockedUri: string, allow: string[]) {
    super(
      "csp_blocked",
      `This page's Content-Security-Policy blocked Prson sign-in: ${directive} doesn't allow ${blockedUri}. ` +
        `Add to connect-src: ${allow.join(" ")}`,
    );
    this.name = "PrsonCspError";
    this.directive = directive;
    this.blockedUri = blockedUri;
    this.allow = allow;
  }
}

/** The connect-src sources a sign-in against `signalingBase` needs. */
export function connectSourcesFor(signalingBase: string, issuerJwksUri?: string): string[] {
  const out = new Set<string>();
  try {
    const u = new URL(signalingBase);
    out.add(u.origin);
    out.add(`${u.protocol === "http:" ? "ws" : "wss"}://${u.host}`);
  } catch {
    /* a bad base fails elsewhere with its own error */
  }
  if (issuerJwksUri) {
    // The dev issuer: its keys and revocation lists are on the dev API.
    try {
      out.add(new URL(issuerJwksUri).origin);
    } catch {
      /* ignore a bad override */
    }
  } else {
    out.add("https://app.prson.net");
    out.add("https://api.prson.net");
  }
  return [...out];
}

function hostOf(uri: string): string | null {
  try {
    return new URL(uri).host;
  } catch {
    return null;
  }
}

function originOf(uri: string): string {
  try {
    const u = new URL(uri);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "(unknown)";
  }
}

export type CspWatch = {
  /** The error to throw instead of `err` when a CSP block explains it, else `err`. */
  explain(err: unknown): Promise<unknown>;
  stop(): void;
};

/**
 * Watch for CSP blocks of Prson hosts during a sign-in. A no-op outside
 * a browser.
 */
export function watchCsp(signalingBase: string, issuerJwksUri?: string): CspWatch {
  if (typeof document === "undefined" || typeof document.addEventListener !== "function") {
    return { explain: async (e) => e, stop: () => {} };
  }
  const allow = connectSourcesFor(signalingBase, issuerJwksUri);
  const prsonHosts = new Set(allow.map(hostOf).filter((h): h is string => !!h));
  let seen: { directive: string; blockedUri: string } | null = null;
  const onViolation = (ev: Event) => {
    // Only the browser's own reports: a page script can dispatch a fake one.
    if (!ev.isTrusted) return;
    const e = ev as SecurityPolicyViolationEvent;
    const host = hostOf(e.blockedURI);
    if (!seen && host && (prsonHosts.has(host) || host.endsWith(".prson.net"))) {
      // The origin only: the path can carry a request id.
      seen = { directive: e.effectiveDirective || e.violatedDirective, blockedUri: originOf(e.blockedURI) };
    }
  };
  document.addEventListener("securitypolicyviolation", onViolation);
  return {
    async explain(err) {
      // The violation event can arrive just after the failed fetch or
      // WebSocket rejects: give it a turn of the event loop.
      if (!seen) await new Promise((r) => setTimeout(r, 0));
      if (!seen) return err;
      const s = seen as { directive: string; blockedUri: string };
      return new PrsonCspError(s.directive, s.blockedUri, allow);
    },
    stop() {
      document.removeEventListener("securitypolicyviolation", onViolation);
    },
  };
}

/**
 * The nonce for injected `<style>` elements, for pages whose `style-src`
 * uses a nonce. Read from the `nonce` attribute of
 * `<meta property="csp-nonce" nonce="…">` (the convention Vite uses).
 * Only the `nonce` attribute: browsers hide it from CSS selectors, while a
 * nonce in `content` could be read out by injected CSS.
 */
export function cspStyleNonce(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const m = document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]');
  if (!m) return undefined;
  return m.nonce || m.getAttribute("nonce") || undefined;
}
