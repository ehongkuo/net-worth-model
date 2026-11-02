(function (root) {
  "use strict";
  const Util =
    typeof module !== "undefined" && module.exports
      ? require("./util")
      : root.Util;
  const Parser = () =>
    typeof module !== "undefined" && module.exports
      ? require("./paystub-parser")
      : root.PaystubParser;
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
  // Total compensation, top down: what you earn (cash pay, equity, money the
  // employer puts in) and where each dollar goes. Built from one CompactFlow
  // graph so both sides reconcile to the same total.
  function compensation(g) {
    const p = g.payroll,
      c = p.contributions || {};
    const items = (rows) => rows.filter((r) => Math.abs(r.value) > 0.005);
    const group = (id, label, rows) => {
      const list = items(rows);
      return {
        id,
        label,
        items: list,
        value: list.reduce((s, r) => s + r.value, 0),
      };
    };
    const parts = (id) => g.buckets.find((b) => b.id === id)?.parts || [];
    const rename = {
      "Spendable cash": "To your bank account",
      "Pending ESPP contributions": "Waiting to buy ESPP shares",
      "Future-tax cash reserve": "Set aside for taxes still due",
      "Retained RSUs": "RSU shares you keep",
      "Projected ESPP equity (not yet purchased)":
        "ESPP shares (not yet bought)",
      "Traditional / Roth 401(k) and employer funding": "401(k)",
    };
    const relabel = (rows) =>
      rows.map((r) => ({ label: rename[r.label] || r.label, value: r.value }));
    const match = Math.min(Math.max(0, c.employer || 0), g.employer);
    const sources = [
      group("pay", "Cash pay", [
        { label: "Base salary", value: p.salary || 0 },
        { label: "Bonus", value: p.bonus || 0 },
        { label: "Allowances", value: p.cashAllowance || 0 },
        { label: "Other cash (ESPP sales, refunds)", value: g.otherCash || 0 },
      ]),
      group("equity", "Equity", [
        { label: "RSUs vested", value: g.rsuGross || 0 },
        {
          label: "ESPP discount on shares kept",
          value: (g.esppValue || 0) - (g.esppCost || 0),
        },
      ]),
      group("employer", "From your employer", [
        { label: "401(k) match", value: match },
        { label: "HSA contribution", value: g.employer - match },
      ]),
    ];
    const uses = [
      group("tax", "Taxes", [
        { label: "Withheld from pay", value: g.cashTax || 0 },
        { label: "RSU shares sold for taxes", value: g.rsuCover || 0 },
      ]),
      group("retirement", "Retirement & HSA", relabel(parts("retirement"))),
      group("benefits", "Health & benefits", [
        { label: "Pre-tax premiums", value: g.benefits || 0 },
        { label: "After-tax deductions", value: g.postBenefits || 0 },
      ]),
      group("kept", "Equity you keep", relabel(parts("equity"))),
      group("cash", "Cash to you", relabel(parts("cash"))),
    ];
    return {
      sources,
      uses,
      total: sources.reduce((s, r) => s + r.value, 0),
    };
  }
  // One paycheck as a short waterfall: gross pay, what comes out, the deposit.
  function paycheck(record) {
    const v = record.current || {};
    const sum = (keys) => keys.reduce((s, k) => s + (v[k] || 0), 0);
    const gross = sum([
      "salary",
      "bonus",
      "rsu",
      "allowance",
      "taxableAllowance",
    ]);
    const steps = [
      ["tax", "Taxes", ["federal", "state", "local", "ss", "medicare", "sdi"]],
      [
        "retirement",
        "Retirement & HSA",
        ["traditional", "roth", "mega", "hsa"],
      ],
      ["benefits", "Health & benefits", ["health", "post"]],
      ["espp", "ESPP", ["espp"]],
      ["rsu", "RSU shares (not cash)", ["rsuOffset"]],
    ]
      .map(([id, label, keys]) => ({ id, label, value: sum(keys) }))
      .filter((s) => Math.abs(s.value) > 0.005);
    const out = steps.reduce((s, r) => s + r.value, 0);
    return {
      gross,
      steps,
      deposit: Math.round((gross - out) * 100) / 100,
      employer: sum(["employer", "hsaEmployer"]),
    };
  }
  // The inputs behind the numbers, each pointing at the setup step that edits it.
  function facts(s) {
    const usd = (n) =>
      n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      });
    const comp = s.compensation,
      tax = s.taxProfile.settings,
      plan = s.employerPlan,
      r = plan.retirement;
    const schedules = {
      weekly: "Every week",
      biweekly: "Every two weeks",
      semimonthly: "Twice a month",
      monthly: "Once a month",
    };
    const filing = { single: "Single", married: "Married filing jointly" };
    const saving = [
      r.traditional > 0 && `${usd(r.traditional)} pre-tax`,
      r.roth > 0 && `${usd(r.roth)} Roth`,
      r.megaEnabled && r.mega > 0 && `${usd(r.mega)} after-tax`,
    ].filter(Boolean);
    const grants = (comp.grants || []).filter(
      (g) => g.value > 0 || g.shares > 0,
    );
    const hsa = (plan.hsa.employee || 0) + (plan.hsa.employer || 0);
    return [
      {
        id: "salary",
        label: "Salary",
        value: comp.salary > 0 ? `${usd(comp.salary)} a year` : "Not set",
        missing: !(comp.salary > 0),
        step: 2,
        section: "plan-compensation",
      },
      {
        id: "schedule",
        label: "Paid",
        value: schedules[comp.frequency] || comp.frequency,
        step: 0,
      },
      {
        id: "tax",
        label: "Files taxes as",
        value: `${filing[tax.filing] || tax.filing} · ${tax.state || "state not set"}`,
        missing: !tax.state,
        step: 1,
      },
      {
        id: "retirement",
        label: "401(k)",
        value: saving.length ? saving.join(" · ") : "Not contributing",
        step: 2,
        section: "plan-retirement",
      },
      {
        id: "hsa",
        label: "HSA",
        value: hsa > 0 ? `${usd(hsa)} a year` : "None",
        step: 2,
        section: "plan-hsa",
      },
      {
        id: "espp",
        label: "ESPP",
        value: plan.espp.enabled
          ? `${Math.round(plan.espp.rate * 100)}% of pay`
          : "Not enrolled",
        step: 2,
        section: "plan-espp",
      },
      {
        id: "grants",
        label: "RSU grants",
        value: grants.length
          ? `${grants.length} grant${grants.length === 1 ? "" : "s"}`
          : "None",
        step: 2,
        section: "plan-compensation",
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
    "taxProfile.settings.rsuFederalRate": [
      "RSU federal withholding",
      "percent",
    ],
    "taxProfile.settings.rsuStateRate": ["RSU state withholding", "percent"],
    "taxProfile.settings.bonusFederalRate": [
      "Bonus federal withholding",
      "percent",
    ],
    "taxProfile.settings.bonusStateRate": [
      "Bonus state withholding",
      "percent",
    ],
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
    const v = Parser().vestHistory(
      s.uploads?.records || [],
      s.taxProfile?.year,
    );
    if (v.ytd > 0)
      rows.push({
        path: "compensation.grants",
        label: "RSU vests so far this year",
        value:
          usd(Math.round(v.ytd)) +
          (v.vests.length
            ? ` · latest ${usd(Math.round(v.vests.at(-1).value))} on ${v.vests.at(-1).date}`
            : ""),
        source: "From paystub",
        basis: `Year-to-date RSU income through ${v.ytdDate}`,
      });
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
    // A paystub shows past vests, never the grants behind future ones.
    const vests = Parser().vestHistory(
      s.uploads?.records || [],
      s.taxProfile?.year,
    );
    if (
      vests.ytd > 0 &&
      !(s.compensation?.grants || []).some((g) => g.value > 0 || g.shares > 0)
    )
      out.push({
        id: "rsu",
        label: "Your RSU grants",
        why: `Your paystubs show ${usd(Math.round(vests.ytd))} of RSU vests this year. Without your grants, future vests aren't forecast.`,
        path: "compensation.grants",
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
    compensation,
    facts,
    paycheck,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Presentation = api;
})(typeof window !== "undefined" ? window : globalThis);
