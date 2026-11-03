const { test, assert } = require("./harness");
test("presentation routes historical estimates to paycheck notes, not global alerts", () => {
  const UI = require("../presentation");
  const n = UI.notices([
    "Earlier paycheck dates and amounts are estimates reconciled to the latest available YTD fields, not uploaded actuals.",
  ]);
  assert(n.alerts.length === 0);
  assert(n.history.length === 1);
});
test("presentation preserves unknown and actionable warnings and removes stale empty notices", () => {
  const UI = require("../presentation");
  const n = UI.notices([
    "Contributions and deductions exceed cash wages; review paycheck funding.",
    "New model warning",
    "New model warning",
  ]);
  assert(n.alerts.length === 2);
  assert(UI.notices([]).alerts.length === 0);
});
test("tax methodology and routine contribution caps are available as contextual notes", () => {
  const UI = require("../presentation");
  const n = UI.notices([
    "California income tax uses 2025 FTB tables projected to 2026 with the editable CA adjustment.",
    "IRA pro-rata inputs are annual planning estimates; update year-end IRA balances before relying on conversion tax.",
    "Traditional 401(k) capped at 24,500.",
  ]);
  assert(n.alerts.length === 0);
  assert(n.tax.length === 2);
  assert(n.assumptions.length === 1);
});
test("every warning reaches something each view renders, exactly once", () => {
  const UI = require("../presentation");
  const warnings = [
    "Earlier paycheck dates and amounts are estimates reconciled to the latest available YTD fields, not uploaded actuals.",
    "California income tax uses 2025 FTB tables projected to 2026 with the editable CA adjustment.",
    "IRA pro-rata inputs are annual planning estimates; update year-end IRA balances before relying on conversion tax.",
    "Traditional 401(k) capped at 24,500.",
    "New model warning",
  ];
  for (const view of Object.keys(UI.INLINE)) {
    const n = UI.forView(warnings, view);
    const shown = [
      ...n.attention,
      ...n.notes,
      ...UI.INLINE[view].flatMap((k) => n[k]),
    ];
    for (const w of warnings) assert(shown.includes(w), `${view} drops: ${w}`);
    assert(
      new Set(shown).size === shown.length,
      `${view} shows a warning twice`,
    );
  }
});
test("attention banner holds only actionable alerts on every view", () => {
  const UI = require("../presentation");
  const methodology = [
    "California income tax uses 2025 FTB tables projected to 2026 with the editable CA adjustment.",
    "IRA pro-rata inputs are annual planning estimates; update year-end IRA balances before relying on conversion tax.",
    "Traditional 401(k) capped at 24,500.",
    "Earlier paycheck dates and amounts are estimates reconciled to the latest available YTD fields, not uploaded actuals.",
  ];
  const alert =
    "Contributions and deductions exceed cash wages; review paycheck funding.";
  for (const view of ["monthly", "tax", "lifetime"]) {
    const n = UI.forView([...methodology, alert], view);
    assert(
      n.attention.length === 1 && n.attention[0] === alert,
      `${view} attention: ${n.attention.join(" | ")}`,
    );
    assert(UI.forView(methodology, view).attention.length === 0);
  }
  // Methodology notes stay visible in the model notes where not shown inline.
  const lifetime = UI.forView(methodology, "lifetime");
  assert(lifetime.notes.length === methodology.length);
  const monthly = UI.forView(methodology, "monthly");
  assert(monthly.notes.length === 3 && monthly.history.length === 1);
});
test("setup lists what a paystub can't answer, most important first", () => {
  const UI = require("../presentation"),
    S = require("../scenario");
  const s = S.defaults();
  assert(
    UI.missing(s)
      .map((m) => m.id)
      .join() === "spending,balances,age,filing,state",
  );
  s.projection.monthlyExpenses.housing = 2000;
  s.projection.startingBalances.cash = 5000;
  s.taxProfile.settings.filing = "married";
  s.taxProfile.settings.state = "CA";
  s.uploads.confirmedFields = {
    "taxProfile.age": 30,
    "taxProfile.settings.filing": "married",
  };
  s.employerPlan.hsa.eligible = true;
  s.uploads.fieldSources = {
    "employerPlan.hsa.eligible": { sourceDate: "2026-09-18", basis: "HSA" },
  };
  s.employerPlan.espp.enabled = true;
  assert(
    UI.missing(s)
      .map((m) => m.id)
      .join() === "spouse,hsa,espp",
  );
});
test("what we learned lists paystub values and inferences with their source", () => {
  const UI = require("../presentation"),
    S = require("../scenario");
  const s = S.defaults();
  s.compensation.salary = 165000;
  s.employerPlan.hsa.coverage = "family";
  s.uploads.fieldSources = {
    "compensation.salary": { sourceDate: "2026-09-18", basis: "Annualized" },
    "employerPlan.hsa.coverage": {
      sourceDate: "2026-09-18",
      basis: "Above self-only limit",
      inferred: true,
    },
  };
  s.uploads.elections = {
    traditional: { mode: "percent", value: 0.19, sourceDate: "2026-09-18" },
  };
  const rows = UI.learned(s);
  const row = (label) => rows.find((r) => r.label === label);
  assert(row("Annual salary").value === "$165,000");
  assert(row("Annual salary").source === "From paystub");
  assert(row("HSA coverage").value === "Family");
  assert(row("HSA coverage").source === "Inferred");
  assert(row("Traditional 401(k)").value === "19% of pay");
  s.uploads.manualFields = ["compensation.salary"];
  assert(!UI.learned(s).some((r) => r.label === "Annual salary"));
});

test("an inferred filing status is still asked about until confirmed", () => {
  const UI = require("../presentation"),
    S = require("../scenario");
  const s = S.defaults();
  s.taxProfile.settings.filing = "married";
  s.uploads.fieldSources = {
    "taxProfile.settings.filing": {
      sourceDate: "2026-09-18",
      basis: "W-4 status",
      inferred: true,
    },
  };
  assert(UI.missing(s).some((m) => m.id === "filing"));
  s.uploads.confirmedFields = { "taxProfile.settings.filing": "married" };
  assert(!UI.missing(s).some((m) => m.id === "filing"));
});
