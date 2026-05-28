/**
 * DOM binding helpers — drive a `session.request(...)` from a
 * page's existing form elements.
 *
 * Two entry points:
 *
 *   * [`bindInput`] — for a single `<input>` / `<textarea>` /
 *     `<select>` element. Reads the element's `type`, `name`,
 *     `placeholder`, `required`, `min`/`max`/`minlength`/`maxlength`
 *     /`pattern`, and (for `<select>`) `<option>` children. Returns
 *     a controller whose `.request()` method synthesises a single
 *     `kind: "input"` request and, on a successful wallet reply,
 *     writes the value back into the element and dispatches
 *     `input` + `change` events so reactive frameworks pick it up.
 *
 *   * [`bindForm`] — for a `<form>` (or any container holding
 *     inputs). Walks descendant `<input>`/`<textarea>`/`<select>`
 *     elements in document order, synthesises one
 *     `kind: "input-form"` request carrying every field, opens
 *     a single wallet drawer that paginates prev / next / send,
 *     fills every element on reply, and (when the bind target is
 *     a `<form>`) calls `requestSubmit()` so the page's existing
 *     submit handlers fire.
 *
 * Neither helper auto-fires. The host wires the controller's
 * `.request()` to whatever trigger they prefer — a button click,
 * focus, route change, etc. Keeps the SDK out of UX decisions
 * about WHEN to ask.
 */

import type { PrsonLoginSession } from "./session.js";
import type {
  InputFormField,
  InputOption,
  InputType,
  LoginRequest,
  LoginResponse,
  RequestOptions,
} from "./requests.js";

// ─── Public API ────────────────────────────────────────────────────

export interface BindController {
  /**
   * Synthesise a request from the bound element + send it. Resolves
   * with whatever the wallet replied (already written into the
   * element(s) on success). Multiple concurrent calls share the
   * same controller; the wallet's queue / rate-limit policy
   * decides whether the second one is accepted.
   */
  request(opts?: RequestOptions & { reason?: string }): Promise<LoginResponse>;
  /** Drop any per-bind state. The helpers are stateless today, but
   *  the contract is reserved for future expansion (e.g. a
   *  focus-triggered auto-bind). */
  dispose(): void;
}

/**
 * Bind to a single input-shaped element. Accepted nodes:
 *
 *   * `<input>` (type ∈ text/search/email/tel/url/number/password
 *     — falls back to `text` for unsupported types like `date`),
 *   * `<textarea>` (treated as a `text` input),
 *   * `<select>` (with `<option>` children).
 *
 * The element's `aria-label`, label-for, or closest `<label>` text
 * becomes the wallet's prompt label. `placeholder` rides through.
 * Numeric / pattern constraints become wallet-side validation.
 *
 * Reply: the wallet's `value` is written via `element.value = ...`
 * + `input` + `change` events. For `<select>`, the value is matched
 * against the option `value` attributes.
 */
export function bindInput(
  session: PrsonLoginSession,
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): BindController {
  return {
    async request(opts) {
      const req = inputRequestFromElement(element, opts?.reason);
      const reply = await session.request(req, opts);
      if (reply.ok) writeValueIntoElement(element, reply.value);
      return reply;
    },
    dispose() {/* no-op for now */},
  };
}

/**
 * Bind to a `<form>` or any container element. Walks descendant
 * input-shaped elements in document order, sends ONE
 * `kind: "input-form"` request, and on reply fills every matching
 * field + dispatches events.
 *
 * Field name resolution:
 *
 *   1. `element.name` — the canonical key.
 *   2. `element.id` — fallback for label-less inputs.
 *   3. `_field_<index>` — synthetic fallback so the reply still
 *      finds its target.
 *
 * If the bound container IS a `<form>`, a successful reply also
 * fires `form.requestSubmit()` so the host's existing submit
 * handler picks up. Containers that aren't forms skip the submit
 * step.
 *
 * Buttons/checkboxes/hidden inputs are ignored on purpose — they
 * don't fit the kiosk-input shape and confuse the wallet drawer.
 */
export function bindForm(
  session: PrsonLoginSession,
  container: HTMLElement,
): BindController {
  return {
    async request(opts) {
      const elements = collectFieldElements(container);
      if (elements.length === 0) {
        return {
          ok: false,
          error: "unsupported",
        } as LoginResponse;
      }
      // Single-element shortcut — friendlier UX (one focused drawer,
      // smaller envelope) than wrapping a lone input in an input-form.
      if (elements.length === 1) {
        const reply = await session.request(
          inputRequestFromElement(elements[0]!, opts?.reason),
          opts,
        );
        if (reply.ok) writeValueIntoElement(elements[0]!, reply.value);
        if (reply.ok && container instanceof HTMLFormElement) {
          tryRequestSubmit(container);
        }
        return reply;
      }
      const fields = elements.map((el, i) => fieldFromElement(el, i));
      const req: LoginRequest = {
        kind: "input-form",
        fields,
        submitLabel: container instanceof HTMLFormElement ? "Send" : "Done",
        reason: opts?.reason,
      };
      const reply = await session.request(req, opts);
      if (reply.ok && reply.value && typeof reply.value === "object") {
        const values = reply.value as Record<string, unknown>;
        for (const el of elements) {
          const name = nameForElement(el, elements.indexOf(el));
          if (name in values) writeValueIntoElement(el, values[name]);
        }
        if (container instanceof HTMLFormElement) tryRequestSubmit(container);
      }
      return reply;
    },
    dispose() {/* no-op */},
  };
}

// ─── DOM → request synthesis ───────────────────────────────────────

function inputRequestFromElement(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  reason: string | undefined,
): LoginRequest {
  if (el instanceof HTMLSelectElement) {
    return {
      kind: "input",
      inputType: "select",
      label: resolveLabel(el),
      options: readOptions(el),
      defaultValue: el.value || undefined,
      required: el.required,
      reason,
    };
  }
  const inputType = resolveInputType(el);
  const base = {
    kind: "input" as const,
    inputType,
    label: resolveLabel(el),
    placeholder: el.placeholder || undefined,
    defaultValue: el.value || undefined,
    required: el instanceof HTMLInputElement ? el.required : false,
    reason,
  };
  return {
    ...base,
    ...textConstraints(el),
    ...(el instanceof HTMLInputElement && inputType === "number"
      ? numericConstraints(el)
      : {}),
    ...(el instanceof HTMLInputElement && el.pattern
      ? { pattern: el.pattern }
      : {}),
  };
}

function fieldFromElement(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  index: number,
): InputFormField {
  const name = nameForElement(el, index);
  if (el instanceof HTMLSelectElement) {
    return {
      name,
      inputType: "select",
      label: resolveLabel(el),
      options: readOptions(el),
      defaultValue: el.value || undefined,
      required: el.required,
    };
  }
  const inputType = resolveInputType(el);
  return {
    name,
    inputType,
    label: resolveLabel(el),
    placeholder: el.placeholder || undefined,
    defaultValue: el.value || undefined,
    required: el instanceof HTMLInputElement ? el.required : false,
    ...textConstraints(el),
    ...(el instanceof HTMLInputElement && inputType === "number"
      ? numericConstraints(el)
      : {}),
    ...(el instanceof HTMLInputElement && el.pattern
      ? { pattern: el.pattern }
      : {}),
  };
}

function collectFieldElements(
  container: HTMLElement,
): Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> {
  const out: Array<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  > = [];
  const all = container.querySelectorAll<HTMLElement>(
    "input, textarea, select",
  );
  // Filter: skip non-bindable inputs (button, submit, hidden,
  // checkbox, radio, file). Those don't map to the kiosk pattern
  // and would confuse the drawer's prev/next navigation.
  const SKIPPED = new Set([
    "button",
    "submit",
    "reset",
    "image",
    "hidden",
    "file",
    "checkbox",
    "radio",
  ]);
  for (let i = 0; i < all.length; i++) {
    const el = all[i]!;
    if (el instanceof HTMLInputElement) {
      const t = (el.type || "text").toLowerCase();
      if (SKIPPED.has(t)) continue;
      if (el.disabled || el.readOnly) continue;
      out.push(el);
    } else if (el instanceof HTMLTextAreaElement) {
      if (el.disabled || el.readOnly) continue;
      out.push(el);
    } else if (el instanceof HTMLSelectElement) {
      if (el.disabled) continue;
      out.push(el);
    }
  }
  return out;
}

function resolveInputType(
  el: HTMLInputElement | HTMLTextAreaElement,
): Exclude<InputType, "select"> {
  if (el instanceof HTMLTextAreaElement) return "text";
  const t = (el.type || "text").toLowerCase();
  switch (t) {
    case "text":
    case "search":
    case "email":
    case "tel":
    case "url":
    case "number":
    case "password":
      return t as Exclude<InputType, "select">;
    // HTML5 types we don't have a wallet-side keyboard for — fall
    // back to `text` so the drawer still renders something useful.
    case "date":
    case "datetime-local":
    case "time":
    case "month":
    case "week":
    case "color":
    case "range":
    default:
      return "text";
  }
}

function resolveLabel(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): string {
  // Priority: aria-label > <label for> > parent <label> text >
  // placeholder > name > tag-name.
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim()) return aria.trim();
  if (el.id) {
    const lbl = el.ownerDocument.querySelector<HTMLLabelElement>(
      `label[for="${cssEscape(el.id)}"]`,
    );
    if (lbl && lbl.textContent && lbl.textContent.trim()) {
      return lbl.textContent.trim();
    }
  }
  const closestLabel = el.closest("label");
  if (closestLabel && closestLabel.textContent) {
    // Strip the input's own text content from the label string
    // so a wrapping `<label>Email <input></label>` doesn't include
    // the input's value.
    const raw = closestLabel.textContent.replace(el.value, "").trim();
    if (raw) return raw;
  }
  if (
    "placeholder" in el &&
    (el as HTMLInputElement).placeholder &&
    (el as HTMLInputElement).placeholder.trim()
  ) {
    return (el as HTMLInputElement).placeholder.trim();
  }
  if (el.name) return prettyName(el.name);
  return prettyName(el.tagName.toLowerCase());
}

function readOptions(el: HTMLSelectElement): InputOption[] {
  const out: InputOption[] = [];
  for (let i = 0; i < el.options.length; i++) {
    const opt = el.options[i]!;
    out.push({
      value: opt.value,
      label: opt.label || opt.textContent || opt.value,
    });
  }
  return out;
}

function textConstraints(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): { minLength?: number; maxLength?: number } {
  const out: { minLength?: number; maxLength?: number } = {};
  if ("minLength" in el && el.minLength > 0) out.minLength = el.minLength;
  if ("maxLength" in el && el.maxLength > 0) out.maxLength = el.maxLength;
  return out;
}

function numericConstraints(
  el: HTMLInputElement,
): { min?: number; max?: number } {
  const out: { min?: number; max?: number } = {};
  const minStr = el.getAttribute("min");
  const maxStr = el.getAttribute("max");
  if (minStr !== null && minStr !== "") {
    const n = Number(minStr);
    if (Number.isFinite(n)) out.min = n;
  }
  if (maxStr !== null && maxStr !== "") {
    const n = Number(maxStr);
    if (Number.isFinite(n)) out.max = n;
  }
  return out;
}

function nameForElement(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  index: number,
): string {
  if (el.name) return el.name;
  if (el.id) return el.id;
  return `_field_${index}`;
}

function prettyName(s: string): string {
  return s.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

// ─── Reply → DOM ───────────────────────────────────────────────────

function writeValueIntoElement(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: unknown,
): void {
  if (value === undefined || value === null) return;
  const str = String(value);
  if (el instanceof HTMLSelectElement) {
    // Match by value first, then by visible label.
    let matched = false;
    for (let i = 0; i < el.options.length; i++) {
      if (el.options[i]!.value === str) {
        el.selectedIndex = i;
        matched = true;
        break;
      }
    }
    if (!matched) {
      for (let i = 0; i < el.options.length; i++) {
        if (el.options[i]!.label === str) {
          el.selectedIndex = i;
          break;
        }
      }
    }
  } else {
    el.value = str;
  }
  // Reactive frameworks (React, Vue, etc.) listen for `input` /
  // `change` to pick up the new value. Dispatch both so we don't
  // miss either bucket.
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function tryRequestSubmit(form: HTMLFormElement): void {
  // `requestSubmit` runs the form's existing submit handler +
  // validation; `submit` skips both. Always prefer
  // `requestSubmit` when available — guards against pre-2020
  // browsers via the typeof check.
  if (typeof form.requestSubmit === "function") {
    form.requestSubmit();
  } else {
    form.submit();
  }
}

// ─── Mouse / virtual cursor ────────────────────────────────────────

/**
 * Options for [`bindMouse`].
 */
export interface BindMouseOptions extends RequestOptions {
  /**
   * Input mode the wallet should default to. The wallet UI may still
   * surface a toggle to switch mid-session — frames received then
   * carry the actual mode in `mouse.mode`. Defaults to `"touch"`.
   */
  mode?: "touch" | "magic";
  /** Cursor diameter in CSS pixels. Default 28. */
  size?: number;
  /**
   * Cursor background colour (any CSS colour). Default a translucent
   * blue that's visible on both light and dark pages.
   */
  color?: string;
  /**
   * Optional reason shown in the wallet drawer ("Tap to control the
   * page", etc.).
   */
  reason?: string;
  /**
   * Initial cursor position. Defaults to viewport centre. Pass
   * `{ x: 0, y: 0 }` to anchor in the top-left.
   */
  initialPosition?: { x: number; y: number };
  /**
   * Optional callback fired on every applied frame. Useful for
   * sites that want to highlight the hovered element or show a
   * trail. Receives the cursor's new viewport coordinates.
   */
  onMove?: (pos: { x: number; y: number }) => void;
  /**
   * Optional click handler — receives the element under the cursor
   * at the moment of the click. The default behaviour (dispatching
   * a synthetic `click` event on that element) still runs unless
   * the callback returns `false`.
   */
  onClick?: (target: Element | null) => void | boolean;
}

/**
 * Bind a virtual mouse to the session. Opens a `kind: "mouse"`
 * request on the wallet, then subscribes to the streamed
 * `mouse-update` envelopes and applies them to a CSS-positioned
 * cursor on top of the page.
 *
 * Two modes (the wallet may toggle them mid-session):
 *
 *   * `"touch"` — the phone is a touchpad. Drag = move (delta in
 *     CSS px), tap = click, double-tap = double-click, two-finger
 *     drag = scroll.
 *   * `"magic"` — phone gyro + accelerometer drive a "magic wand".
 *     Tap on the phone = click; swipe up/down = scroll.
 *
 * The cursor is a `<div>` fixed-positioned at z-index `2147483647`
 * (the max 32-bit signed int — same trick browser extension
 * overlays use to outrank page chrome). `pointer-events: none` so
 * it never intercepts real clicks; we use `elementFromPoint` +
 * synthetic events to forward clicks to the page underneath.
 *
 * Returns a [`BindController`] — call `dispose()` to detach the
 * cursor and stop applying frames. The wallet drawer stays open
 * until the user closes it; disposing the controller silently
 * drops further frames but doesn't tell the wallet to stop.
 *
 * @example
 *   const mouse = bindMouse(session, { mode: "touch" });
 *   await mouse.request();
 *   // later
 *   mouse.dispose();
 */
export function bindMouse(
  session: PrsonLoginSession,
  opts?: BindMouseOptions,
): BindController {
  const mode = opts?.mode ?? "touch";
  const size = Math.max(6, opts?.size ?? 28);
  const color = opts?.color ?? "rgba(59, 130, 246, 0.65)";
  const onMove = opts?.onMove;
  const onClick = opts?.onClick;

  // DOM-side state. The cursor element is created lazily on the
  // first `request()` call so a host that builds the controller
  // up-front but never calls request doesn't pollute the page.
  let cursor: HTMLDivElement | null = null;
  let pos = opts?.initialPosition ?? {
    x: typeof window !== "undefined" ? window.innerWidth / 2 : 0,
    y: typeof window !== "undefined" ? window.innerHeight / 2 : 0,
  };
  let disposed = false;

  function ensureCursor(): HTMLDivElement {
    if (cursor) return cursor;
    const el = document.createElement("div");
    el.setAttribute("data-prson-virtual-cursor", "");
    el.style.position = "fixed";
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.borderRadius = "50%";
    el.style.background = color;
    el.style.border = "2px solid rgba(255, 255, 255, 0.9)";
    el.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.25)";
    el.style.pointerEvents = "none";
    el.style.zIndex = "2147483647";
    el.style.transform = "translate(-50%, -50%)";
    el.style.transition = "background 120ms ease";
    applyCursorPosition(el, pos);
    document.body.appendChild(el);
    cursor = el;
    return el;
  }

  function applyCursorPosition(el: HTMLDivElement, p: { x: number; y: number }) {
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
  }

  function clamp(value: number, min: number, max: number): number {
    return value < min ? min : value > max ? max : value;
  }

  function applyFrame(mouse: NonNullable<import("./crypto.js").DecryptedEnvelope["mouse"]>): void {
    if (disposed) return;
    const el = ensureCursor();
    switch (mouse.event) {
      case "move": {
        pos = {
          x: clamp(pos.x + (mouse.dx ?? 0), 0, window.innerWidth),
          y: clamp(pos.y + (mouse.dy ?? 0), 0, window.innerHeight),
        };
        applyCursorPosition(el, pos);
        if (onMove) {
          try { onMove(pos); } catch { /* swallow */ }
        }
        break;
      }
      case "click":
      case "double-click": {
        // Visual feedback — briefly pulse the cursor so the user
        // sees the click landed even if the underlying element
        // doesn't repaint.
        const prev = el.style.background;
        el.style.background = "rgba(59, 130, 246, 1)";
        setTimeout(() => { if (cursor === el) el.style.background = prev; }, 140);
        const target = document.elementFromPoint(pos.x, pos.y);
        let allowDefault: boolean = true;
        if (onClick) {
          try {
            const ret = onClick(target);
            if (ret === false) allowDefault = false;
          } catch { /* swallow */ }
        }
        if (allowDefault && target) {
          const init: MouseEventInit = {
            bubbles: true,
            cancelable: true,
            clientX: pos.x,
            clientY: pos.y,
            view: window,
          };
          target.dispatchEvent(new MouseEvent("mousedown", init));
          target.dispatchEvent(new MouseEvent("mouseup", init));
          target.dispatchEvent(new MouseEvent("click", init));
          if (mouse.event === "double-click") {
            target.dispatchEvent(new MouseEvent("dblclick", init));
          }
        }
        break;
      }
      case "scroll": {
        // `dy` matches WheelEvent.deltaY — positive = scroll down.
        window.scrollBy({ left: mouse.dx ?? 0, top: mouse.dy ?? 0 });
        break;
      }
    }
  }

  function detach() {
    if (cursor) {
      cursor.remove();
      cursor = null;
    }
  }

  return {
    async request(callerOpts) {
      if (disposed) return { ok: false, error: "session-closed" };
      ensureCursor();
      // `requestMouse` atomically registers the subscriber under the
      // requestId before the envelope leaves the wire, so the very
      // first `mouse-update` frame can never race ahead of us. The
      // session also drops the subscriber on the terminating
      // `response` so we don't need to manage that side ourselves.
      const reply = await session.requestMouse(
        { kind: "mouse", mode, reason: callerOpts?.reason ?? opts?.reason },
        applyFrame,
        callerOpts,
      );
      // Drawer closed (or timed out) — pull the cursor off the page
      // so it doesn't sit there orphaned. Host can call request()
      // again to spawn another session.
      if (!disposed) {
        if (cursor) {
          cursor.remove();
          cursor = null;
        }
      }
      return reply;
    },
    dispose() {
      disposed = true;
      detach();
    },
  };
}

// `CSS.escape` polyfill — older Safari versions sometimes ship
// without it. Hand-rolled escape covers our identifier characters.
function cssEscape(s: string): string {
  if (
    typeof CSS !== "undefined" &&
    typeof (CSS as { escape?: (s: string) => string }).escape === "function"
  ) {
    return CSS.escape(s);
  }
  return s.replace(/(["\\#.>+~*$^|=:()\[\] ])/g, "\\$1");
}
