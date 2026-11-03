/**
 * Minimal QR rendering surface. We deliberately don't bundle a full
 * QR library here — the SDK is tiny and most sites already have one.
 * Instead, we expose a render adapter that the host page can override.
 *
 * Default behaviour: render a placeholder `<div>` with the URL as
 * text + a copy-to-clipboard affordance, and emit a `console.warn`
 * pointing partners at the QR-renderer hook. Production deployments
 * pass a real QR renderer (e.g. `qrcode-svg`, `qr-creator`) via
 * `PrsonLogin.signIn({ ui: { mountQrInto } })` + a global override
 * on `window.__prsonLoginQrRenderer`.
 */

export interface LoginQrHandle {
  /** Tear the QR down (called automatically when the SDK no longer needs it). */
  dispose(): void;
  /**
   * Optional (renderers written before 0.2 don't have it): the SDK
   * reports progress so the UI can show it. For `"success"` the renderer
   * may return a promise; the SDK waits for it (at most 1.5 s) before
   * tearing the UI down, so a check animation can finish.
   */
  update?(state: LoginUiState): void | Promise<void>;
}

/**
 * What the sign-in is doing, as far as the browser can tell:
 *
 *   waiting     the code is on screen
 *   scanned     a wallet claimed the code (the person approved on the
 *               phone, which is now connecting)
 *   approving   the encrypted channel to the phone is open; the phone is
 *               preparing its signed proof
 *   verifying   the proof arrived; the SDK is checking it
 *   success     checked; the UI is about to close
 *   error       something failed; `message` says what, in plain words
 *
 * Expiry isn't sent: the renderer runs the countdown from the code's own
 * server timestamp (`t=`).
 */
export type LoginUiState =
  | { state: "waiting" }
  | { state: "scanned" }
  | { state: "approving" }
  | { state: "verifying" }
  | { state: "success"; domain: string }
  | { state: "error"; message: string };

/** The optional fourth argument the SDK passes to a renderer. */
export interface LoginQrContext {
  /** `"modal"`: inside the SDK's own dialog. `"inline"`: in the host's `mountQrInto`. */
  mode: "modal" | "inline";
  /** The domain the person is signing in to (the same as the code's `d=`). */
  domain: string;
  /**
   * Ask for a fresh code (after expiry or an error): the SDK makes a new
   * draft and renders again, and `signIn()` keeps waiting. The renderer
   * should first dispatch the bubbling `prson-login-refresh-requested`
   * DOM event (the 0.1 contract); if the host re-called `signIn()` from
   * that event, this is a no-op.
   */
  refresh?: () => void;
  /** Close the sign-in: `signIn()` rejects with `LoginAbortedError`. */
  cancel?: () => void;
  /** Where "Don't have Prson? Get it" points. */
  getAppUrl: string;
  /** The id the card's title should carry, so the modal is labelled by it. */
  titleId: string;
}

export type LoginQrRenderer = (
  url: string,
  mount: HTMLElement,
  theme: "light" | "dark" | "auto",
  context?: LoginQrContext,
) => LoginQrHandle;

/**
 * Create a centred modal scrim and return the inner mount element +
 * a dispose handle. Used as the default QR presentation when the
 * host page didn't pass `mountQrInto` — the SDK calls this, then
 * hands the inner mount to `renderLoginQr` exactly like an inline
 * mount.
 *
 * The scrim:
 *   * darkens the page with a 50%-black overlay + a 4 px backdrop
 *     blur (so the partner UI fades into the background but stays
 *     contextual),
 *   * dismisses on **Esc** (any focused field is bypassed via
 *     capture-phase listener — works even with another input
 *     focused),
 *   * dismisses on **click outside** the card,
 *   * sits above every layout via `z-index: 2147483647`.
 *
 * Dismissing fires [onDismiss] — the SDK wires this to abort the
 * in-flight `signIn()` so the host's `await signIn(...)` rejects
 * with `LoginAbortedError` rather than hanging.
 */
export function createModalQrMount(opts: {
  onDismiss: () => void;
  /** The id of the card's title: the dialog is labelled by it. */
  titleId?: string;
}): { mount: HTMLElement; dispose: () => void } {
  const scrim = document.createElement("div");
  scrim.setAttribute("data-prson-login-modal", "1");
  // Phones get a bottom sheet (thumb-reachable); larger screens a centred card.
  const sheet = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 480px)").matches;
  scrim.style.cssText =
    "position:fixed;inset:0;background:rgba(10,10,10,0.45);" +
    "backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);" +
    "z-index:2147483647;display:flex;overflow-y:auto;box-sizing:border-box;" +
    "justify-content:center;" +
    (sheet ? "align-items:flex-end;padding:0;" : "align-items:center;padding:24px 16px;");

  // An accessible dialog: role, aria-modal, labelled by the card's title,
  // focus moved in and kept there (Tab wraps), restored on close.
  const mount = document.createElement("div");
  mount.setAttribute("data-prson-login-modal-mount", "1");
  mount.setAttribute("role", "dialog");
  mount.setAttribute("aria-modal", "true");
  if (opts.titleId) mount.setAttribute("aria-labelledby", opts.titleId);
  else mount.setAttribute("aria-label", "Sign in with Prson");
  mount.tabIndex = -1;
  // The QR card renderer manages its own width via CSS — give it
  // the natural sizing it expects.
  mount.style.cssText =
    "display:flex;align-items:center;justify-content:center;outline:none;max-width:100%;" +
    (sheet ? "width:100%;" : "margin:auto 0;");

  scrim.append(mount);
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const root = document.documentElement;
  const prevOverflow = root.style.overflow;
  root.style.overflow = "hidden";
  document.body.append(scrim);
  // Focus the dialog itself, so a screen reader starts at its title and a
  // stray Enter doesn't press anything.
  setTimeout(() => {
    if (!disposed && !mount.contains(document.activeElement)) mount.focus({ preventScroll: true });
  }, 0);

  let disposed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    document.removeEventListener("keydown", onKey, true);
    scrim.remove();
    root.style.overflow = prevOverflow;
    try {
      previouslyFocused?.focus({ preventScroll: true });
    } catch {
      /* gone from the page */
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape" || e.key === "Esc") {
      e.preventDefault();
      e.stopPropagation();
      opts.onDismiss();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = Array.from(
      mount.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => el.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      e.preventDefault();
      mount.focus();
      return;
    }
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === mount || !mount.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !mount.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  scrim.addEventListener("click", (e) => {
    // Click directly on the scrim (not the card) dismisses. Card
    // taps bubble up from the inner mount; we ignore them.
    if (e.target === scrim || e.target === mount) {
      opts.onDismiss();
    }
  });

  document.addEventListener("keydown", onKey, true);

  return { mount, dispose };
}

export function renderLoginQr(
  url: string,
  mount: HTMLElement,
  theme: "light" | "dark" | "auto",
  context?: LoginQrContext,
): LoginQrHandle {
  const override = (window as unknown as { __prsonLoginQrRenderer?: LoginQrRenderer })
    .__prsonLoginQrRenderer;
  if (override) return override(url, mount, theme, context);

  // Fallback: text + click-to-copy. Good enough for development;
  // partners should install a real QR renderer.
  // eslint-disable-next-line no-console
  console.warn(
    "[@prson/login-sdk] No QR renderer installed. Set window.__prsonLoginQrRenderer " +
      "to a function (url, mount, theme) => { dispose: () => void } before calling signIn().",
  );

  const root = document.createElement("div");
  root.setAttribute("data-prson-qr-fallback", "1");
  root.style.cssText = "font-family:system-ui,sans-serif;font-size:12px;padding:12px;border:1px dashed currentColor;border-radius:8px;word-break:break-all;cursor:pointer;";
  root.textContent = url;
  root.title = "Click to copy. Install a real QR renderer for the production UX.";
  root.addEventListener("click", () => {
    void navigator.clipboard?.writeText(url);
  });
  mount.append(root);

  return {
    dispose() {
      root.remove();
    },
  };
}
