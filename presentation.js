(function (root) {
  "use strict";
  const Util =
    typeof module !== "undefined" && module.exports
      ? require("./util")
      : root.Util;
  function notices(warnings = []) {
    const result = { alerts: [], history: [], tax: [], assumptions: [] };
    for (const text of new Set(warnings)) {
      if (text.startsWith("Earlier paycheck dates")) result.history.push(text);
      else if (/^(California income tax uses|IRA pro-rata inputs)/.test(text))
        result.tax.push(text);
      else if (
        / capped at |^Catch-up contributions moved|^Held RSU taxes|^Unused capital losses/.test(
          text,
        )
      )
        result.assumptions.push(text);
      else result.alerts.push(text);
    }
    return result;
  }
  // Only actionable alerts go to the attention banner. Each view shows the
  // other buckets quietly: the ones listed here in their own place, the rest
  // in the view's model-notes disclosure. Every warning reaches exactly one.
  const INLINE = {
    monthly: ["history"],
    tax: [],
    lifetime: [],
  };
  const NOTE_BUCKETS = ["tax", "assumptions", "history"];
  function forView(warnings, view) {
    const n = notices(warnings),
      inline = INLINE[view] || [];
    return {
      ...n,
      attention: n.alerts,
      notes: NOTE_BUCKETS.flatMap((k) => (inline.includes(k) ? [] : n[k])),
    };
  }
  function overview(payroll, flow, buckets) {
    const assets = (id) => (buckets.find((b) => b.id === id)?.value || 0) / 12;
    return [
      {
        id: "pay",
        label: "Cash pay",
        value:
          ((payroll.salary || 0) +
            (payroll.bonus || 0) +
            (payroll.cashAllowance || 0)) /
          12,
        kind: "cash",
        note: "Salary, bonus and cash allowances",
      },
      {
        id: "rsu",
        label: "RSUs vested",
        value: (payroll.rsuGross || 0) / 12,
        kind: "equity",
        note: "Gross value at assumed share prices",
      },
      {
        id: "tax",
        label: "Taxes",
        value: flow.taxes.total / 12,
        kind: "tax",
        note: "Estimated federal, state and payroll tax",
      },
      {
        id: "cash",
        label: "Cash added",
        value: assets("cash"),
        kind: "cash",
        note: "Before expenses; includes pending ESPP cash and tax reserves",
      },
      {
        id: "equity",
        label: "Equity added",
        value: assets("equity"),
        kind: "equity",
        note: "Retained RSUs and ESPP shares",
      },
      {
        id: "retirement",
        label: "Retirement + HSA",
        value: assets("retirement"),
        kind: "retirement",
        note: "Employee and employer funding",
      },
    ];
  }
  // Status chip and confirm button for a setup field, from Profile.fieldState.
  function fieldBadge(state, path, label) {
    const esc = Util.escape;
    const badge =
      state.kind === "review"
        ? `<span class="field-status">${esc(state.label)}</span>`
        : state.kind === "inferred"
          ? `<span class="field-status field-inferred" title="${esc(state.basis)}">Inferred</span>`
          : "";
    const approve =
      (state.kind === "review" && state.label !== "Needs input") ||
      state.kind === "inferred"
        ? `<button type="button" class="confirm-field" data-confirm="${esc(path)}" aria-label="Confirm ${esc(label)}">${state.kind === "inferred" ? "Confirm" : "Confirm assumption"}</button>`
        : "";
    return { badge, approve };
  }
  const api = { notices, fieldBadge, forView, INLINE, NOTE_BUCKETS, overview };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Presentation = api;
})(typeof window !== "undefined" ? window : globalThis);
