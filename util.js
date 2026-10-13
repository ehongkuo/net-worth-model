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
  const api = {
    escape,
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
