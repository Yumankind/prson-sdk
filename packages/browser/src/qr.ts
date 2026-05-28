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
