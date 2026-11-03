/**
 * The "Sign in with Prson" button: the Prson mark (the "p" on a rounded
 * square) and a label, in four variants, at least 44 px tall. Three ways
 * to use it:
 *
 *   1. The custom element (registered on import):
 *        <prson-signin-button variant="amber" size="lg"></prson-signin-button>
 *      It renders a real <button> inside (light DOM, so forms, focus and
 *      your CSS work as usual). Listen for "click" on the element.
 *
 *   2. From script:
 *        const btn = createSignInButton({ variant: "dark", onClick: () => PrsonLogin.signIn({...}) });
 *        document.querySelector("#login").append(btn);
 *
 *   3. Plain HTML + the injected stylesheet:
 *        <button class="prson-signin-btn prson-signin-btn--amber">…mark…<span>Sign in with Prson</span></button>
 *      (`prsonMarkSvg()` gives you the mark's markup.)
 *
 * Variants: "amber" (default, the brand's primary on light pages), "dark"
 * (ink, for light pages that want less colour), "light" (white, for dark
 * or busy backgrounds), "outline" (transparent, takes the text colour).
 * Sizes: "md" 44 px, "lg" 52 px.
 */

export type SignInButtonVariant = "amber" | "dark" | "light" | "outline";
export type SignInButtonSize = "md" | "lg";

export type SignInButtonOptions = {
  variant?: SignInButtonVariant;
  size?: SignInButtonSize;
  /** Default "Sign in with Prson". */
  label?: string;
  /** Stretch to the container's width. */
  fullWidth?: boolean;
  onClick?: (e: MouseEvent) => void;
};

const P_STEM =
  "M46.2623 100.265C43.9277 100.265 41.9617 99.5892 40.3643 98.2375C38.8898 96.8859 38.1526 95.1657 38.1526 93.0768V70.5907C38.1526 66.0444 37.1082 62.7882 35.0193 60.8222C33.0533 58.8562 30.5958 57.8732 27.6468 57.8732C24.5749 57.8732 21.9946 58.8562 19.9057 60.8222C17.9397 62.7882 16.711 65.0614 16.2195 67.6417V92.3396C16.2195 94.4284 15.4208 96.2101 13.8234 97.6846C12.3489 99.0362 10.5058 99.712 8.29404 99.712C5.95942 99.712 3.99343 99.0362 2.39606 97.6846C0.798686 96.333 0 94.6127 0 92.5239V51.238C0 49.272 0.737248 47.6132 2.21174 46.2615C3.80912 44.787 5.83655 44.0498 8.29404 44.0498C10.26 44.0498 11.9188 44.6027 13.2705 45.7086C14.6221 46.6916 15.5437 47.9818 16.0352 49.5792C19.3528 45.2785 24.3906 43.1282 31.1487 43.1282C38.0297 43.1282 43.6205 45.1557 47.9211 49.2105C52.2218 53.2654 54.3721 59.7163 54.3721 68.5633V93.4454C54.3721 95.4114 53.5734 97.0702 51.976 98.4219C50.5015 99.6506 48.597 100.265 46.2623 100.265Z";
const P_DOT =
  "M26.7637 0.900391C29.8673 0.900391 32.6569 1.60533 35.1299 3.01758C37.6743 4.35994 39.6881 6.26878 41.1719 8.74121C42.6585 11.1465 43.3994 13.9742 43.3994 17.2197C43.3994 20.3955 42.6579 23.2567 41.1738 25.8008C39.6892 28.2744 37.6757 30.2181 35.1328 31.6309C32.6582 33.043 29.8683 33.75 26.7637 33.75C23.9181 33.75 21.2882 33.1284 18.875 31.8867L18.3945 31.6309C15.8521 30.2184 13.8036 28.2754 12.25 25.8037C10.764 23.2567 10.0235 20.3954 10.0234 17.2197C10.0234 13.9742 10.7643 11.1466 12.25 8.74121L12.5469 8.2832C14.0617 6.03176 16.012 4.27606 18.3965 3.01758C20.9392 1.60538 23.729 0.900409 26.7637 0.900391ZM26.7637 9.63086C24.682 9.63089 22.9161 10.3241 21.4609 11.71C20.0799 13.0921 19.3857 14.9255 19.3857 17.2197C19.3858 19.4431 20.0804 21.3133 21.4658 22.8379C22.9209 24.2919 24.6846 25.0185 26.7637 25.0186C28.915 25.0186 30.6429 24.2913 31.9561 22.8398L32.208 22.5498C33.4264 21.0797 34.0361 19.3046 34.0361 17.2197C34.0361 14.9244 33.3414 13.0904 31.959 11.708L31.7061 11.4551C30.4267 10.2404 28.7819 9.63086 26.7637 9.63086Z";

/** The Prson mark as SVG markup: the "p" ([glyph]) on a rounded square ([square]). Decorative (aria-hidden). */
export function prsonMarkSvg(opts: { size?: number; square?: string; glyph?: string } = {}): string {
  const size = opts.size ?? 24;
  const square = opts.square ?? "#FBBF24";
  const glyph = opts.glyph ?? "#0A0A0A";
  return (
    `<svg class="prson-mark" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="24" height="24" rx="6" fill="${square}"/>` +
    `<g transform="translate(7.2 3.15) scale(0.175)" fill="${glyph}"><path d="${P_STEM}"/><path d="${P_DOT}"/></g></svg>`
  );
}

const MARK_COLOURS: Record<SignInButtonVariant, { square: string; glyph: string }> = {
  amber: { square: "#0A0A0A", glyph: "#FBBF24" },
  dark: { square: "#FBBF24", glyph: "#0A0A0A" },
  light: { square: "#FBBF24", glyph: "#0A0A0A" },
  outline: { square: "#FBBF24", glyph: "#0A0A0A" },
};

const VARIANTS: SignInButtonVariant[] = ["amber", "dark", "light", "outline"];

function variantOf(v: string | null | undefined): SignInButtonVariant {
  return VARIANTS.includes(v as SignInButtonVariant) ? (v as SignInButtonVariant) : "amber";
}

/** Fill [btn] with the mark and label and set its classes. */
function decorate(btn: HTMLButtonElement, o: SignInButtonOptions): void {
  const variant = variantOf(o.variant);
  btn.className = [
    "prson-signin-btn",
    `prson-signin-btn--${variant}`,
    o.size === "lg" ? "prson-signin-btn--lg" : "",
    o.fullWidth ? "prson-signin-btn--block" : "",
  ]
    .filter(Boolean)
    .join(" ");
  btn.innerHTML = prsonMarkSvg({ size: o.size === "lg" ? 26 : 22, ...MARK_COLOURS[variant] });
  const label = document.createElement("span");
  label.className = "prson-signin-btn__label";
  label.textContent = o.label ?? "Sign in with Prson";
  btn.append(label);
}

/** A ready "Sign in with Prson" <button>. */
export function createSignInButton(opts: SignInButtonOptions = {}): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  decorate(btn, opts);
  if (opts.onClick) btn.addEventListener("click", opts.onClick);
  return btn;
}

/**
 * `<prson-signin-button variant size label full-width disabled busy>`.
 * `busy` shows a spinner and sets aria-busy; `disabled` disables the inner button.
 */
export function defineSignInButtonElement(tag = "prson-signin-button"): void {
  if (typeof window === "undefined" || !("customElements" in window) || customElements.get(tag)) return;
  class PrsonSignInButtonElement extends HTMLElement {
    static get observedAttributes() {
      return ["variant", "size", "label", "full-width", "disabled", "busy"];
    }
    private btn: HTMLButtonElement | null = null;
    connectedCallback() {
      if (!this.btn) {
        this.btn = document.createElement("button");
        this.btn.type = "button";
        this.append(this.btn);
      }
      this.render();
    }
    attributeChangedCallback() {
      if (this.btn) this.render();
    }
    private render() {
      const btn = this.btn!;
      decorate(btn, {
        variant: variantOf(this.getAttribute("variant")),
        size: this.getAttribute("size") === "lg" ? "lg" : "md",
        label: this.getAttribute("label") ?? undefined,
        fullWidth: this.hasAttribute("full-width"),
      });
      if (this.hasAttribute("full-width")) this.style.display = "block";
      btn.disabled = this.hasAttribute("disabled");
      const busy = this.hasAttribute("busy");
      if (busy) btn.setAttribute("aria-busy", "true");
      else btn.removeAttribute("aria-busy");
      btn.classList.toggle("prson-signin-btn--busy", busy);
    }
  }
  customElements.define(tag, PrsonSignInButtonElement);
}
