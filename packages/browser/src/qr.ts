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
}

export type LoginQrRenderer = (
  url: string,
  mount: HTMLElement,
  theme: "light" | "dark" | "auto",
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
}): { mount: HTMLElement; dispose: () => void } {
  const scrim = document.createElement("div");
  scrim.setAttribute("data-prson-login-modal", "1");
  scrim.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,0.5);" +
    "backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);" +
    "z-index:2147483647;display:flex;align-items:center;" +
    "justify-content:center;padding:24px;box-sizing:border-box;";

  const mount = document.createElement("div");
  mount.setAttribute("data-prson-login-modal-mount", "1");
  // The QR card renderer manages its own width via CSS — give it
  // the natural sizing it expects.
  mount.style.cssText = "display:flex;align-items:center;justify-content:center;";

  scrim.append(mount);
  document.body.append(scrim);

  let disposed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    document.removeEventListener("keydown", onKey, true);
    scrim.remove();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape" || e.key === "Esc") {
      e.preventDefault();
      e.stopPropagation();
      opts.onDismiss();
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
): LoginQrHandle {
  const override = (window as unknown as { __prsonLoginQrRenderer?: LoginQrRenderer })
    .__prsonLoginQrRenderer;
  if (override) return override(url, mount, theme);

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
