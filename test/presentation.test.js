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
test("profile overview uses monthly financial totals and includes employer asset funding", () => {
  const UI = require("../presentation");
  const cards = UI.overview(
    { salary: 120000, bonus: 12000, cashAllowance: 1200, rsuGross: 24000 },
    { taxes: { total: 36000 } },
    [
      { id: "cash", value: 60000 },
      { id: "equity", value: 30000 },
      { id: "retirement", value: 36000 },
    ],
  );
  assert(cards.length === 6);
  assert(
    cards.map((c) => c.value).join(",") === "11100,2000,3000,5000,2500,3000",
  );
  assert(cards.every((c) => Number.isFinite(c.value)));
});
test("profile overview preserves negative cash and handles zero activity", () => {
  const UI = require("../presentation");
  const cards = UI.overview(
    { salary: 0, bonus: 0, rsuGross: 0 },
    { taxes: { total: 0 } },
    [
      { id: "cash", value: -1200 },
      { id: "equity", value: 0 },
      { id: "retirement", value: 0 },
    ],
  );
  assert(cards.find((c) => c.id === "cash").value === -100);
  assert(cards.filter((c) => c.id !== "cash").every((c) => c.value === 0));
});
test("every warning reaches something each view renders", () => {
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
    const shown = [...n.attention, ...UI.INLINE[view].flatMap((k) => n[k])];
    for (const w of warnings) assert(shown.includes(w), `${view} drops: ${w}`);
    assert(
      new Set(shown).size === shown.length,
      `${view} shows a warning twice`,
    );
  }
});
