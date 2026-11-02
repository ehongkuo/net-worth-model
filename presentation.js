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
  const LEARNED = {
    "compensation.salary": ["Annual salary", "money"],
    "compensation.frequency": ["Pay frequency", "frequency"],
    "compensation.firstPayday": ["Recent payday", "text"],
    "taxProfile.year": ["Tax year", "text"],
    "taxProfile.settings.filing": ["Filing status", "filing"],
    "taxProfile.settings.state": ["State income tax", "state"],
    "taxProfile.settings.customStateRate": ["State effective rate", "percent"],
    "taxProfile.settings.localRate": ["Local income tax rate", "percent"],
    "employerPlan.hsa.eligible": ["HSA", "yes"],
    "employerPlan.hsa.coverage": ["HSA coverage", "coverage"],
    "employerPlan.retirement.megaEnabled": ["After-tax 401(k)", "yes"],
    "employerPlan.retirement.employerAnnual": [
      "Employer 401(k) funding",
      "money",
    ],
    "employerPlan.espp.enabled": ["ESPP", "yes"],
    "employerPlan.espp.rate": ["ESPP contribution", "percent"],
    "compensation.bonusPercent": ["Bonus", "percent"],
    "compensation.bonusMonth": ["Bonus month", "month"],
  };
  const ELECTIONS = {
    traditional: "Traditional 401(k)",
    roth: "Roth 401(k)",
    mega: "After-tax 401(k) contribution",
    hsa: "HSA contribution",
  };
  const usd = (n) =>
    Number(n).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: n % 1 ? 2 : 0,
    });
  const display = (kind, v) =>
    ({
      money: () => usd(v),
      percent: () => `${(v * 100).toFixed(2).replace(/\.?0+$/, "")}%`,
      frequency: () =>
        ({
          weekly: "Weekly",
          biweekly: "Every two weeks",
          semimonthly: "Twice a month",
          monthly: "Monthly",
        })[v] || v,
      filing: () => (v === "married" ? "Married filing jointly" : "Single"),
      state: () =>
        v === "CA"
          ? "California"
          : v === "none"
            ? "None"
            : v
              ? "Other state"
              : "Not set",
      coverage: () => (v === "family" ? "Family" : "Self-only"),
      yes: () => (v ? "Yes" : "No"),
      month: () =>
        new Date(2026, v - 1, 1).toLocaleString("en-US", { month: "long" }),
    })[kind]?.() ?? String(v);
  const read = (s, path) => path.split(".").reduce((v, k) => v?.[k], s);
  // Readable label and value for any setup path (falls back to the path's
  // last segment).
  const labelFor = (path) =>
    LEARNED[path]?.[0] ||
    path
      .split(".")
      .at(-1)
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (c) => c.toUpperCase());
  const formatValue = (path, v) =>
    LEARNED[path] ? display(LEARNED[path][1], v) : String(v);
  // Everything the paystub supplied or the model inferred, with its source.
  function learned(s) {
    const sources = s.uploads?.fieldSources || {},
      manual = s.uploads?.manualFields || [],
      rows = [];
    for (const [path, [label, kind]] of Object.entries(LEARNED)) {
      const src = sources[path];
      if (!src || manual.includes(path)) continue;
      rows.push({
        path,
        label,
        value: display(kind, read(s, path)),
        source: src.inferred ? "Inferred" : "From paystub",
        basis: src.basis,
      });
    }
    for (const [key, label] of Object.entries(ELECTIONS)) {
      const e = s.uploads?.elections?.[key];
      if (!e?.sourceDate || e.manual) continue;
      rows.push({
        path: `uploads.elections.${key}.value`,
        label,
        value:
          e.mode === "percent"
            ? `${display("percent", e.value)} of pay`
            : `${usd(e.value)} per paycheck`,
        source: "From paystub",
        basis: `Paycheck on ${e.sourceDate}`,
      });
    }
    return rows;
  }
  // What a paystub can't tell us, most impactful first. Each item names the
  // setup path to open so the UI can jump straight to it.
  function missing(s) {
    const confirmed = (path) =>
      Object.hasOwn(s.uploads?.confirmedFields || {}, path) ||
      (s.uploads?.manualFields || []).includes(path) ||
      Boolean(s.uploads?.fieldSources?.[path]);
    const sum = (o) => Object.values(o || {}).reduce((n, v) => n + (v || 0), 0);
    const out = [];
    if (!(sum(s.projection?.monthlyExpenses) > 0))
      out.push({
        id: "spending",
        label: "Monthly spending",
        why: "Without it, projections assume you spend nothing.",
        path: "projection.monthlyExpenses.housing",
      });
    if (!(sum(s.projection?.startingBalances) > 0))
      out.push({
        id: "balances",
        label: "What you already have saved",
        why: "Projections start from $0 until you add balances.",
        path: "projection.startingBalances.cash",
      });
    if (!confirmed("taxProfile.age"))
      out.push({
        id: "age",
        label: "Your age",
        why: "Sets catch-up limits and your retirement timeline.",
        path: "taxProfile.age",
      });
    // A W-4 withholding status is only a guess at the filing status, so an
    // inferred value still needs an answer.
    if (
      !confirmed("taxProfile.settings.filing") ||
      (s.uploads?.fieldSources?.["taxProfile.settings.filing"]?.inferred &&
        !Object.hasOwn(
          s.uploads?.confirmedFields || {},
          "taxProfile.settings.filing",
        ))
    )
      out.push({
        id: "filing",
        label: "Filing status",
        why: "Paystubs rarely show it; it changes your tax brackets.",
        path: "taxProfile.settings.filing",
      });
    if (!s.taxProfile?.settings?.state)
      out.push({
        id: "state",
        label: "State income tax",
        why: "Until you choose a state, no state income tax is included.",
        path: "taxProfile.settings.state",
      });
    if (
      s.taxProfile?.settings?.filing === "married" &&
      !confirmed("taxProfile.settings.spouseIncome") &&
      !(s.taxProfile.settings.spouseIncome > 0)
    )
      out.push({
        id: "spouse",
        label: "Spouse income",
        why: "Joint filing taxes both incomes together.",
        path: "taxProfile.settings.spouseIncome",
      });
    if (
      s.employerPlan?.hsa?.eligible &&
      confirmed("employerPlan.hsa.eligible") &&
      !confirmed("employerPlan.hsa.coverage")
    )
      out.push({
        id: "hsa",
        label: "HSA coverage (self-only or family)",
        why: "Sets your HSA limit; a paystub only proves family coverage late in the year.",
        path: "employerPlan.hsa.coverage",
      });
    const e = s.employerPlan?.espp;
    if (
      e?.enabled &&
      !(
        confirmed("employerPlan.espp.offerPrice") &&
        confirmed("employerPlan.espp.purchasePrice")
      )
    )
      out.push({
        id: "espp",
        label: "ESPP share prices and offering dates",
        why: "ESPP results use placeholder $100 prices until you add them.",
        path: "employerPlan.espp.offerPrice",
      });
    return out;
  }
  const api = {
    notices,
    fieldBadge,
    labelFor,
    formatValue,
    learned,
    missing,
    forView,
    INLINE,
    NOTE_BUCKETS,
    overview,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Presentation = api;
})(typeof window !== "undefined" ? window : globalThis);
