(function (root) {
  "use strict";
  // Shared helpers. Loaded first in index.html and required by the engines in Node.
  const ENTITIES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  const escape = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (c) => ENTITIES[c]);
  const usd = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const money = (value) => usd.format(Number(value) || 0);
  const positive = (v) => Math.max(0, Number(v) || 0);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
  // Dates are ISO yyyy-mm-dd strings handled at UTC noon to avoid DST/zone drift.
  const utcDate = (s) => new Date(`${s}T12:00:00Z`);
  const isoDate = (d) => d.toISOString().slice(0, 10);
  // Calendar-month offset that clamps to the target month's last day (Jan 31 + 1 = Feb 28/29).
  function addMonths(s, n) {
    const d = utcDate(s),
      day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    d.setUTCDate(
      Math.min(
        day,
        new Date(
          Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
        ).getUTCDate(),
      ),
    );
    return isoDate(d);
  }
  // Deep merge of plain objects (arrays replace). Skips prototype-polluting keys
  // because merged input can come from imported scenario files.
  function merge(a, b) {
    const out = { ...a };
    for (const [key, value] of Object.entries(b || {})) {
      if (["__proto__", "constructor", "prototype"].includes(key)) continue;
      out[key] =
        value && typeof value === "object" && !Array.isArray(value)
          ? merge(a?.[key] || {}, value)
          : value;
    }
    return out;
  }
  // Re-rendering a container replaces (or re-parents) its focused element, which
  // drops keyboard focus to <body>. Find the focused element's stable key before
  // rendering and refocus its replacement afterwards. A focused <summary> is
  // keyed by its <details>.
  const FOCUS_KEYS = [
    "data-path",
    "data-key",
    "id",
    "data-confirm",
    "data-step",
    "data-grant-allocation",
    "data-remove-grant",
  ];
  function focusKey(el) {
    const target = el.tagName === "SUMMARY" ? el.parentElement : el;
    for (const attr of FOCUS_KEYS)
      if (target?.hasAttribute?.(attr))
        return {
          attr,
          value: target.getAttribute(attr),
          summary: target !== el,
        };
    if (target?.tagName === "DETAILS")
      return { summary: true, text: el.textContent };
    return null;
  }
  function preserveFocus(container, rerender) {
    const doc = container.ownerDocument,
      active = doc.activeElement,
      key = active && container.contains(active) ? focusKey(active) : null;
    let range = null;
    try {
      if (key && active.selectionStart != null)
        range = [
          active.selectionStart,
          active.selectionEnd,
          active.selectionDirection,
        ];
    } catch {}
    rerender();
    if (!key) return;
    const find = (attr, value) =>
      [...container.querySelectorAll(`[${attr}]`)].find(
        (el) => el.getAttribute(attr) === value,
      );
    const match = !key.attr
      ? [...container.querySelectorAll("details > summary")].find(
          (el) => el.textContent === key.text,
        )?.parentElement
      : find(key.attr, key.value) ||
        // A confirmed assumption's button disappears; move to its field.
        (key.attr === "data-confirm" ? find("data-path", key.value) : null);
    const next = key.summary ? match?.querySelector("summary") : match;
    if (!next || doc.activeElement === next) return;
    next.focus({ preventScroll: true });
    try {
      if (range) next.setSelectionRange(...range);
      // Number inputs have no selection API; select all as keyboard entry does.
      else if (next.type === "number") next.select();
    } catch {}
  }
  const api = {
    escape,
    preserveFocus,
    merge,
    money,
    positive,
    clamp,
    utcDate,
    isoDate,
    addMonths,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Util = api;
})(typeof window !== "undefined" ? window : globalThis);
