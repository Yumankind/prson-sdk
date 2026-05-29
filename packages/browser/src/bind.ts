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
import {
  closeAllOverlays,
  findNearestClickableInOverlay,
  isSelectOverlayActive,
  openSelectOverlay,
  setOverlaySnap,
} from "./select_overlay.js";
import {
  closePointPhoneOverlay,
  openPointPhoneOverlay,
} from "./point_phone_overlay.js";
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
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement,
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
    const ownText =
      "value" in el && typeof (el as { value?: unknown }).value === "string"
        ? (el as { value: string }).value
        : (el.textContent ?? "");
    const raw = closestLabel.textContent.replace(ownText, "").trim();
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
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement,
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

// ─── Remote navigation ─────────────────────────────────────────────

export interface RemoteNavController {
  /**
   * Stop pushing focus events to the wallet + stop listening for
   * inbound nav/value/logout commands. The session itself stays
   * live; only the helper detaches.
   */
  dispose(): void;
}

export interface RemoteNavOptions {
  /**
   * Root to scan for tabbable inputs. Defaults to `document.body`.
   * Limit to a region (e.g. a checkout form) if the page has
   * unrelated inputs you don't want the wallet to step through.
   */
  root?: HTMLElement;
  /**
   * Override the default tab order. By default we use a generous
   * `:is(input, textarea, select)` filter excluding hidden / disabled
   * / readonly / type=hidden / type=submit. Return your own
   * NodeList-like array to take full control.
   */
  collectFields?: () => Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;
}

/**
 * Wire up **remote navigation**. Pushes the page's currently-focused
 * input to the wallet (metadata + current value) and applies inbound
 * `nav` / `value` / `logout` commands as the user interacts with the
 * wallet's persistent navigation banner.
 *
 * Wiring summary:
 *
 *   * `focusin` on any tabbable input → `session._sendFocus(focus)`.
 *   * `focusout` on the same → `session._sendFocus(null)`.
 *   * `input` on the focused element → push the new value to the
 *      wallet so the phone mirror stays in sync if the user typed on
 *      the desktop. Debounced to one frame to avoid flooding.
 *   * Inbound `nav: "prev" | "next"` → move DOM focus along the
 *      tabbable-input order from the focused element.
 *   * Inbound `nav: "submit"` → `form.requestSubmit()` on the closest
 *      enclosing form.
 *   * Inbound `value` → write to the focused element + dispatch
 *      `input` + `change`. Reactive frameworks pick it up.
 *   * Inbound `logout` → session already torn down by the dispatcher;
 *      helper just detaches.
 *
 * Call this once after `signIn()` resolves when you passed
 * `remoteNavigation: true`. The returned controller's `dispose()` is
 * idempotent and runs on `signed_out` automatically.
 */
export function enableRemoteNavigation(
  session: PrsonLoginSession,
  opts?: RemoteNavOptions,
): RemoteNavController {
  const root = opts?.root ?? document.body;
  let currentFocused:
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement
    | HTMLButtonElement
    | null = null;
  let disposed = false;

  function isBindable(
    el: Element,
  ): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
    if (el instanceof HTMLInputElement) {
      const t = (el.type || "text").toLowerCase();
      if (
        t === "hidden" || t === "submit" || t === "button" ||
        t === "reset" || t === "image" || t === "file" ||
        t === "checkbox" || t === "radio"
      ) return false;
      return !el.disabled && !el.readOnly;
    }
    if (el instanceof HTMLTextAreaElement) {
      return !el.disabled && !el.readOnly;
    }
    if (el instanceof HTMLSelectElement) {
      return !el.disabled;
    }
    return false;
  }

  /** Buttons + button-type inputs. Tracked separately from
   *  [isBindable] so prev/next navigation only walks the
   *  input-like pool, but focus envelopes still fire for buttons
   *  (so the wallet can show the Enter row). */
  function isFocusableButton(
    el: Element,
  ): el is HTMLButtonElement | HTMLInputElement {
    if (el instanceof HTMLButtonElement) return !el.disabled;
    if (el instanceof HTMLInputElement) {
      const t = (el.type || "text").toLowerCase();
      return (t === "submit" || t === "button" || t === "reset") && !el.disabled;
    }
    return el.getAttribute("role") === "button";
  }

  function collectFields(): Array<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  > {
    if (opts?.collectFields) return opts.collectFields();
    const out: Array<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    > = [];
    const all = root.querySelectorAll<HTMLElement>("input, textarea, select");
    for (let i = 0; i < all.length; i++) {
      const el = all[i]!;
      if (isBindable(el)) out.push(el);
    }
    return out;
  }

  /**
   * Compute the prev / next / submit / enter visibility hints the
   * wallet's banner drawer needs to render only the buttons that
   * make sense for the page's current state.
   *
   * Rules (mirrored on the wallet — see `_navigationRow`):
   *
   *   * `hasPrev`     — there's at least one bindable input *before*
   *                     this one in the tabbing pool.
   *   * `hasNext`     — there's at least one bindable input *after*
   *                     this one.
   *   * `isLastInForm`— this element is the last bindable input
   *                     inside its enclosing `<form>`. Mutually
   *                     exclusive with `hasNext` when the form
   *                     ends the bindable pool; only true for input-
   *                     like elements, never for buttons.
   *   * `isButton`    — the focused element is a click target
   *                     (`<button>`, `<input type=submit|button>`,
   *                     `role="button"`). The wallet shows an
   *                     "Enter" button that dispatches `nav: "submit"`,
   *                     and the helper here treats that action as a
   *                     synthetic click rather than a form submit.
   */
  function computeNavMeta(
    el: Element,
  ): { hasPrev: boolean; hasNext: boolean; isLastInForm: boolean; isButton: boolean } {
    const isButton =
      el instanceof HTMLButtonElement ||
      (el instanceof HTMLInputElement &&
        (el.type === "submit" || el.type === "button" || el.type === "reset")) ||
      el.getAttribute("role") === "button";
    if (isButton) {
      // A focused button has no concept of "prev/next input" — the
      // wallet hides those rows entirely and shows just Enter.
      return { hasPrev: false, hasNext: false, isLastInForm: false, isButton: true };
    }
    const fields = collectFields();
    const idx = fields.indexOf(el as HTMLInputElement);
    const hasPrev = idx > 0;
    const hasNext = idx >= 0 && idx < fields.length - 1;
    let isLastInForm = false;
    const form = (el as HTMLElement).closest?.("form");
    if (form instanceof HTMLFormElement) {
      const fieldsInForm = fields.filter((f) => f.closest("form") === form);
      isLastInForm =
        fieldsInForm.length > 0 &&
        fieldsInForm[fieldsInForm.length - 1] === el;
    }
    return { hasPrev, hasNext, isLastInForm, isButton: false };
  }

  function focusPayloadFor(
    el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement,
  ): Parameters<PrsonLoginSession["_sendFocus"]>[0] {
    const name = nameForElement(el, 0);
    const meta = computeNavMeta(el);
    if (el instanceof HTMLButtonElement || (el instanceof HTMLInputElement &&
        (el.type === "submit" || el.type === "button" || el.type === "reset"))) {
      // Button focus — the wallet renders just the Enter row.
      return {
        name,
        label: resolveLabel(el),
        inputType: "button",
        value: el instanceof HTMLButtonElement ? (el.textContent ?? "").trim() : (el as HTMLInputElement).value,
        ...meta,
      };
    }
    if (el instanceof HTMLSelectElement) {
      return {
        name,
        label: resolveLabel(el),
        inputType: "select",
        value: el.value,
        options: readOptions(el),
        required: el.required,
        ...meta,
      };
    }
    const inputType = resolveInputType(el);
    return {
      name,
      label: resolveLabel(el),
      inputType,
      value: el.value,
      placeholder:
        "placeholder" in el ? (el as HTMLInputElement).placeholder || undefined : undefined,
      required: el instanceof HTMLInputElement ? el.required : false,
      ...textConstraints(el),
      ...(el instanceof HTMLInputElement && inputType === "number"
        ? numericConstraints(el)
        : {}),
      ...(el instanceof HTMLInputElement && el.pattern
        ? { pattern: el.pattern }
        : {}),
      ...meta,
    };
  }

  // Debounced "current value changed locally" notifier — keeps the
  // wallet mirror in sync if the user types on the desktop while the
  // wallet drawer is open. requestAnimationFrame caps push rate
  // at ~60 Hz which is well below the wallet's processing budget.
  let pendingFrame: number | null = null;
  function scheduleValuePush() {
    if (pendingFrame !== null) return;
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      if (disposed || !currentFocused) return;
      void session._sendFocus(focusPayloadFor(currentFocused));
    });
  }

  function onFocusIn(ev: Event) {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    if (isBindable(t)) {
      currentFocused = t;
      void session._sendFocus(focusPayloadFor(t));
      return;
    }
    if (isFocusableButton(t)) {
      currentFocused = t as HTMLButtonElement | HTMLInputElement;
      void session._sendFocus(focusPayloadFor(t as HTMLButtonElement));
    }
  }

  function onFocusOut(ev: Event) {
    const t = ev.target;
    if (t !== currentFocused) return;
    currentFocused = null;
    void session._sendFocus(null);
  }

  function onInputChange(ev: Event) {
    if (ev.target !== currentFocused) return;
    scheduleValuePush();
  }

  function applyNav(action: "prev" | "next" | "submit") {
    if (action === "submit") {
      // Two semantics on one wire action:
      //
      //   * focused element IS a button → click it. Wallet shows
      //     this as "Enter" when [isButton: true] in the focus
      //     envelope, and the user expects pressing it on the
      //     phone to fire the button's click handler.
      //   * else → submit the enclosing form. Wallet shows this as
      //     "Submit" when [isLastInForm: true].
      //
      // We use one nav action for both so the wire grammar stays
      // narrow; the contextual UX is decided on the wallet side
      // (different label / icon) and the dispatch routes correctly
      // by inspecting `currentFocused`.
      const focused = currentFocused;
      if (
        focused instanceof HTMLButtonElement ||
        (focused instanceof HTMLInputElement &&
          (focused.type === "submit" ||
            focused.type === "button" ||
            focused.type === "reset")) ||
        focused?.getAttribute("role") === "button"
      ) {
        try {
          (focused as HTMLElement).click();
        } catch {
          /* swallow */
        }
        return;
      }
      const form =
        currentFocused?.closest("form") ?? root.querySelector("form");
      if (form instanceof HTMLFormElement) tryRequestSubmit(form);
      return;
    }
    const fields = collectFields();
    if (fields.length === 0) return;
    let idx = currentFocused ? fields.indexOf(currentFocused as never) : -1;
    if (idx === -1) idx = action === "prev" ? fields.length : -1;
    const target =
      action === "next"
        ? fields[(idx + 1) % fields.length]!
        : fields[(idx - 1 + fields.length) % fields.length]!;
    target.focus();
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const len = target.value.length;
      try { target.setSelectionRange(len, len); } catch { /* select-type inputs don't support it */ }
    }
  }

  function applyValue(value: string) {
    if (!currentFocused) return;
    // Value pushes only make sense for input-like fields. If a
    // button is focused (no editable value) just drop the push.
    if (
      currentFocused instanceof HTMLInputElement ||
      currentFocused instanceof HTMLTextAreaElement ||
      currentFocused instanceof HTMLSelectElement
    ) {
      writeValueIntoElement(currentFocused, value);
    }
  }

  const unsubscribe = session._setRemoteNavListener((envelope) => {
    if (envelope.msg === "nav") applyNav(envelope.action);
    else if (envelope.msg === "value") applyValue(envelope.value);
    else if (envelope.msg === "logout") dispose();
  });

  // `signed_out` cleanup — the dispatcher's `logout` case also tears
  // the session down; this catches every other terminal path (TTL,
  // wallet-side revoke, transport loss).
  const offSignedOut = session.on("signed_out", () => dispose());

  root.addEventListener("focusin", onFocusIn, true);
  root.addEventListener("focusout", onFocusOut, true);
  root.addEventListener("input", onInputChange, true);
  root.addEventListener("change", onInputChange, true);

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
    pendingFrame = null;
    root.removeEventListener("focusin", onFocusIn, true);
    root.removeEventListener("focusout", onFocusOut, true);
    root.removeEventListener("input", onInputChange, true);
    root.removeEventListener("change", onInputChange, true);
    unsubscribe();
    offSignedOut();
  }

  return { dispose };
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
  /**
   * The currently-previewed snap target, if any. Only populated
   * while magic mode is active — every move frame finds the
   * nearest interactive element and rewires this state so the
   * page can style "what would be clicked if I tapped now":
   *
   *     [data-prson-magic-snap] { outline: 2px solid #3b82f6; }
   *
   * The data-attribute is the public contract; the corresponding
   * class is added too as a convenience for selector-shy host
   * stylesheets. Cleared on dispose / mode-change so a left-over
   * highlight can't outlive the controller.
   */
  let snapTarget: Element | null = null;
  /** Active mode for the current frame stream — kept in sync with
   *  `mouse.mode` on every applied envelope so snap-preview turns
   *  itself off when the wallet flips back to touch. */
  let activeMode: "touch" | "magic" = mode;

  // Install the ambient mouse-update handler so wallet-initiated
  // streams (the pre-grant flow — `signIn({mouseControl: true})`)
  // land on `applyFrame` even when there's no pending
  // `requestMouse` promise to key the subscriber by. `bindMouse`
  // owns the handler for its lifetime; `dispose()` removes it.
  // The handler is installed eagerly (not on first `request()`) so
  // the wallet can start streaming the moment the user taps
  // Touchpad / Magic on the banner drawer — even if the host hasn't
  // called `.request()` at all.
  // Window focus → `control-status` for the wallet. When the page
  // tab loses focus the wallet drops into a "Remote control paused"
  // state so the user can see, on the phone, that motion isn't
  // landing anywhere. Listeners are torn down in `detach()`.
  function onWindowBlur(): void {
    if (disposed) return;
    void session._sendControlStatus(true);
  }
  function onWindowFocus(): void {
    if (disposed) return;
    void session._sendControlStatus(false);
    // Real OS focus also implies the user is back at the keyboard
    // → drop the "point your phone" hint if it was still up.
    closePointPhoneOverlay();
  }
  if (typeof window !== "undefined") {
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);
    // Initial state — fire once so a session created while the tab
    // is hidden lands on the wallet correctly.
    if (typeof document !== "undefined" && document.hasFocus && !document.hasFocus()) {
      void session._sendControlStatus(true);
    }
  }

  const offAmbient = session._setAmbientMouseHandler((mouseBody) => {
    if (disposed) return;
    // `begin` / `end` are protocol pairing tokens — they just need to
    // make sure the cursor element exists (so the first real `move`
    // frame doesn't race the lazy initialiser) and are otherwise
    // no-ops. **Every other event** — including the visibility
    // toggles `show` / `hide` — must be forwarded to `applyFrame`,
    // which is what opens / closes the "point your phone" overlay
    // and re-centres the cursor on resume.
    if (mouseBody.event === "begin" || mouseBody.event === "end") {
      ensureCursor();
      return;
    }
    applyFrame(mouseBody);
  });

  function ensureCursor(): HTMLDivElement {
    if (cursor) return cursor;
    // Dedupe across multiple `bindMouse` calls. If another instance
    // already created a cursor (e.g. the long-lived ambient bind
    // from sign-in + a per-request bind from a host button click),
    // adopt the existing element instead of stacking a second one.
    // We still own its position state from this controller — the
    // last `bindMouse` to call `ensureCursor` becomes the visible
    // owner. (Prior owners just stop applying frames.)
    const existing = document.querySelector<HTMLDivElement>(
      '[data-prson-virtual-cursor]',
    );
    if (existing) {
      cursor = existing;
      // Update size/colour to match our opts so a second mount can
      // restyle the cursor without flicker.
      existing.style.width = `${size}px`;
      existing.style.height = `${size}px`;
      existing.style.background = color;
      existing.style.display = "block";
      applyCursorPosition(existing, pos);
      return existing;
    }
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
    el.style.transition = "background 120ms ease, opacity 120ms ease";
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

  function setSnapTarget(next: Element | null): void {
    if (next === snapTarget) return;
    if (snapTarget) {
      snapTarget.removeAttribute("data-prson-magic-snap");
      (snapTarget as Element).classList.remove("prson-magic-snap");
    }
    snapTarget = next;
    if (snapTarget) {
      snapTarget.setAttribute("data-prson-magic-snap", "");
      (snapTarget as Element).classList.add("prson-magic-snap");
    }
  }

  function applyFrame(mouse: NonNullable<import("./crypto.js").DecryptedEnvelope["mouse"]>): void {
    if (disposed) return;
    const el = ensureCursor();
    // The wallet may toggle mode mid-stream. Track the active mode
    // here so move frames know whether to maintain the snap-target
    // highlight (magic) or drop it (touch).
    if (mouse.mode === "touch" || mouse.mode === "magic") {
      if (mouse.mode !== activeMode) {
        activeMode = mouse.mode;
        if (activeMode === "touch") setSnapTarget(null);
      }
    }
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
        // Magic-mode snap preview. Refreshed on every move frame so
        // the highlight tracks the cursor. The DOM query + N rect
        // measurements run at most once per browser repaint
        // (`mouse-update` is already wallet-throttled to ~60 Hz),
        // which is acceptable on every page we ship for.
        if (activeMode === "magic") {
          if (isSelectOverlayActive()) {
            // Page-side highlight stays cleared; the snap visual
            // lives inside the overlay's own shadow root (the page
            // can't reach it, and the page's selector can't
            // accidentally override the option styling).
            setSnapTarget(null);
            setOverlaySnap(findNearestClickableInOverlay(pos.x, pos.y));
          } else {
            setOverlaySnap(null);
            setSnapTarget(findNearestClickable(pos.x, pos.y));
          }
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
        // Custom-overlay route. While a select overlay is open the
        // page beneath is non-interactive — clicks land ONLY on
        // overlay elements (close button, page-up / page-down,
        // option buttons). The overlay's shadow-DOM listener
        // handles the actual semantics (close vs. paginate vs.
        // commit option); we just need to dispatch a click event
        // on the right inner element.
        if (isSelectOverlayActive()) {
          const overlayTarget =
            (snapTarget && (snapTarget as Element).closest?.(
              "[data-prson-select-close],[data-prson-select-page],[data-prson-select-option]",
            )) ??
            findNearestClickableInOverlay(pos.x, pos.y);
          if (overlayTarget) {
            const init: MouseEventInit = {
              bubbles: true,
              cancelable: true,
              composed: true,
              clientX: pos.x,
              clientY: pos.y,
              view: window,
            };
            overlayTarget.dispatchEvent(new MouseEvent("mousedown", init));
            overlayTarget.dispatchEvent(new MouseEvent("mouseup", init));
            overlayTarget.dispatchEvent(new MouseEvent("click", init));
          }
          break;
        }
        // Click-area enlargement: a virtual cursor is harder to land
        // precisely than a touch finger or a mouse, especially for a
        // gyro-driven wand. Search for the NEAREST interactive
        // element within [SNAP_RADIUS_PX] of the cursor and target
        // that, even if the cursor isn't strictly on top of it.
        // Falls back to whatever's at the cursor coordinate when no
        // candidate is within range (so clicks on free space, scroll
        // areas, etc. still work normally).
        //
        // Magic mode already maintains `snapTarget` via the move-
        // frame preview; touch mode skips the highlight but still
        // gets snap-on-click. Re-query in touch mode so the click
        // semantic stays identical across modes.
        const snapped =
          activeMode === "magic"
            ? snapTarget
            : findNearestClickable(pos.x, pos.y);
        // Native <select>s open an OS-drawn list that the virtual
        // cursor can't reach. Replace the click with a custom
        // shadow-DOM overlay the cursor CAN drive.
        if (snapped instanceof HTMLSelectElement) {
          openSelectOverlay(snapped);
          // Clear the page-side snap highlight on the select so the
          // overlay's own snap visuals take over cleanly.
          setSnapTarget(null);
          break;
        }
        const direct = document.elementFromPoint(pos.x, pos.y);
        const target = snapped ?? direct;
        // When we snapped, dispatch at the SNAPPED element's centre
        // so any positional logic inside the page (e.g. a custom
        // dropdown computing position from `clientX`) sees a hit
        // ON the element rather than in dead space next to it.
        const clickPoint = snapped
          ? rectCenter((snapped as Element).getBoundingClientRect())
          : { x: pos.x, y: pos.y };
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
            clientX: clickPoint.x,
            clientY: clickPoint.y,
            view: window,
          };
          target.dispatchEvent(new MouseEvent("mousedown", init));
          target.dispatchEvent(new MouseEvent("mouseup", init));
          target.dispatchEvent(new MouseEvent("click", init));
          if (mouse.event === "double-click") {
            target.dispatchEvent(new MouseEvent("dblclick", init));
          }
          // Inputs and other focusable elements don't always auto-
          // focus from synthetic `mousedown`. Explicitly focus the
          // snapped target so the page sees the same focus state it
          // would after a real touch.
          if (
            snapped &&
            typeof (target as HTMLElement).focus === "function"
          ) {
            try {
              (target as HTMLElement).focus({ preventScroll: true });
            } catch {
              /* swallow — some host elements throw on focus */
            }
          }
        }
        break;
      }
      case "scroll": {
        // `dy` matches WheelEvent.deltaY — positive = scroll down.
        window.scrollBy({ left: mouse.dx ?? 0, top: mouse.dy ?? 0 });
        break;
      }
      case "hide": {
        // Wallet's pose detector says the phone is no longer
        // pointing at the screen. Pull the cursor off the page so
        // the user gets immediate feedback, and surface a soft
        // blue-glow + "point your phone" pill so they know how to
        // resume. The overlay auto-dismisses after 15 s or on real
        // OS mouse movement (whichever first).
        if (cursor) {
          cursor.style.opacity = "0";
          cursor.style.pointerEvents = "none";
        }
        setSnapTarget(null);
        setOverlaySnap(null);
        openPointPhoneOverlay();
        break;
      }
      case "show": {
        // Wand pose restored — bring the cursor back and clear the
        // "point your phone" hint regardless of which trigger
        // (timeout / mousemove / show) wins the race.
        //
        // **Re-centre the cursor.** After a pause the user has lost
        // mental track of where the cursor was; pinning it at the
        // viewport centre gives them a known starting point and
        // matches the "wand on / wand off" mental model (each
        // session begins at the middle). Position resets via
        // `applyCursorPosition` so subsequent move frames integrate
        // from the centre.
        const el = ensureCursor();
        el.style.opacity = "1";
        if (typeof window !== "undefined") {
          pos = {
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          };
          applyCursorPosition(el, pos);
        }
        closePointPhoneOverlay();
        break;
      }
      case "begin":
      case "end": {
        // Wallet-side stream lifecycle markers (pre-grant flow).
        // Nothing for the cursor renderer to do — `_setAmbientMouseHandler`
        // already calls `ensureCursor()` on these so a real `move`
        // frame doesn't race the lazy initialiser.
        break;
      }
    }
  }

  function detach() {
    if (cursor) {
      cursor.remove();
      cursor = null;
    }
    // Clear any lingering magic-mode highlight so the page doesn't
    // keep a `data-prson-magic-snap` attribute on whichever input
    // happened to be the last preview target.
    setSnapTarget(null);
    setOverlaySnap(null);
    // Close any active select overlay so a disposing cursor doesn't
    // leave the dropdown orphaned on the page.
    closeAllOverlays();
    closePointPhoneOverlay();
    // Drop window-focus listeners so a torn-down controller doesn't
    // keep pushing control-status envelopes onto a closed channel.
    if (typeof window !== "undefined") {
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
    }
    // Tear down the ambient subscription so the session stops
    // holding a ref to our (now-disposed) handler.
    offAmbient();
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
      // Mouse requests stay open as long as the user is driving the
      // wallet's controller — that can easily be longer than the
      // generic `request()` default of 60 s. Pick the smaller of
      // (a) the session's hard expiry and (b) the `setTimeout`
      // int32 ceiling (~24.8 days). The credential's exp can sit
      // weeks out, but `setTimeout(fn, > 2^31-1)` overflows and
      // fires on the next tick — exactly the bug that caused
      // `bindMouse` to resolve with `error: "timeout"` the moment
      // it was awaited.
      const MAX_SAFE_TIMEOUT = 2_147_483_000;
      const credentialBudget = session.expiresAt - Date.now() + 1_000;
      const sessionEndMs = Math.max(
        60_000,
        Math.min(credentialBudget, MAX_SAFE_TIMEOUT),
      );
      const reply = await session.requestMouse(
        { kind: "mouse", mode, reason: callerOpts?.reason ?? opts?.reason },
        applyFrame,
        { timeoutMs: sessionEndMs, ...callerOpts },
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

// ─── Click-area enlargement (virtual-cursor snap) ──────────────────
//
// CSS selector covering every realistic click target on a page —
// form controls + anchor-style affordances. The query runs once per
// click (low frequency relative to move frames), so the cost is
// acceptable even on a long page; we do NOT walk the DOM on every
// move frame.
const SNAP_SELECTOR =
  'input:not([type="hidden"]):not([disabled]),' +
  'textarea:not([disabled]),' +
  'select:not([disabled]),' +
  'button:not([disabled]),' +
  'a[href],' +
  '[role="button"],' +
  '[role="link"],' +
  '[role="checkbox"],' +
  '[role="radio"],' +
  'label[for],' +
  '[tabindex]:not([tabindex="-1"])';

/** Snap radius in CSS pixels. A click further than this from any
 *  interactive element falls through to whatever's at the cursor
 *  coordinate. Tuned so a comfortable wand flick lands in the
 *  right input without over-reaching across the page. */
const SNAP_RADIUS_PX = 60;

function rectCenter(r: DOMRect): { x: number; y: number } {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Find the closest interactive element to the cursor whose bounding
 * box lies within [SNAP_RADIUS_PX]. Distance is measured to the
 * nearest edge of the element's rect (0 if inside), so wide elements
 * "win" over narrow ones at the same centre distance. Returns null
 * when nothing qualifies — the caller then falls back to
 * `document.elementFromPoint`.
 *
 * If multiple inputs sit equally close (tie), the one earliest in
 * the DOM wins — `querySelectorAll` iterates in document order, so
 * the strictly-less-than comparison preserves it.
 */
function findNearestClickable(x: number, y: number): Element | null {
  if (typeof document === "undefined") return null;
  const candidates = document.querySelectorAll(SNAP_SELECTOR);
  let best: Element | null = null;
  let bestDist = Infinity;
  for (const el of Array.from(candidates)) {
    const rect = (el as Element).getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue; // hidden / collapsed
    // Distance from (x,y) to rect: 0 if inside, else Euclidean from
    // the nearest edge / corner.
    const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) {
      bestDist = dist;
      best = el;
    }
  }
  return bestDist <= SNAP_RADIUS_PX ? best : null;
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
