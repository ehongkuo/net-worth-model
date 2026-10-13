const { test, assert, assertClose } = require("./harness");
const C = require("../compensation"),
  F = require("../money-flow"),
  T = require("../tax-engine");
const UI = require("../input-rules"),
  { taxChartLayout } = require("../tax-ui");
const cfg = C.merge(C.defaults(), {
  salary: 120000,
  frequency: "monthly",
  bonusPercent: 0.1,
  bonusMonth: 3,
  tax: { state: "none" },
  retirement: { traditional: 12000 },
  hsa: { employee: 2400 },
  grants: [
    {
      value: 12000,
      grantPrice: 100,
      start: "2025-12-31",
      months: 12,
      interval: 3,
      saleMode: "cover",
    },
  ],
  espp: {
    enabled: true,
    rate: 0.1,
    holdShares: false,
    fractional: false,
    offerPrice: 100,
    purchasePrice: 100,
    salePrice: 100,
  },
});
test("current month uses actual bonus, vesting, ESPP dates and matches the monthly ledger", () => {
  const p = C.calculate(cfg),
    f = C.cashFlow(p, { expenses: 24000 });
  for (let month = 1; month <= 12; month++) {
    const selected = F.forMonth(p, f, month),
      g = F.buildFlow(selected.payroll, selected.flow),
      m = f.months[month - 1];
    assertClose(selected.payroll.bonus, month === 3 ? 12000 : 0);
    assertClose(
      selected.payroll.rsuGross,
      [3, 6, 9, 12].includes(month) ? 3000 : 0,
    );
    assertClose(
      selected.payroll.espp.proceeds + selected.payroll.espp.refunds,
      m.esppProceeds,
      0.001,
    );
    assertClose(
      g.summary.remainingCash - g.summary.fundingNeeded,
      m.spendableCashFlow,
      0.001,
      `month ${month}`,
    );
    for (const n of g.nodes.filter((n) => n.kind === "hub"))
      assertClose(
        g.links
          .filter((l) => l.target === n.id)
          .reduce((s, l) => s + l.value, 0),
        g.links
          .filter((l) => l.source === n.id)
          .reduce((s, l) => s + l.value, 0),
        0.001,
        n.id,
      );
  }
});
test("ordered Sankey has all sources left and preserves cash, taxes and assets", () => {
  const p = C.calculate(cfg),
    f = C.cashFlow(p, { expenses: 24000 }),
    g = F.orderFlow(F.buildFlow(p, f));
  assert(
    g.nodes.filter((n) => n.kind === "source").every((n) => n.column === 0),
  );
  assert(
    g.nodes.filter((n) => n.kind === "asset").every((n) => n.column === 5),
  );
  assert(g.nodes.some((n) => n.id === "combined" && n.column === 1));
  for (const n of g.nodes.filter((n) => n.kind === "hub"))
    assertClose(
      g.links.filter((l) => l.target === n.id).reduce((s, l) => s + l.value, 0),
      g.links.filter((l) => l.source === n.id).reduce((s, l) => s + l.value, 0),
      0.001,
      n.id,
    );
  assertClose(g.summary.netCashFlow, f.netCashFlow, 0.001);
});
test("California HSA treatment is automatic even with an old saved checkbox", () => {
  const a = T.calculate({ wages: 120000, hsa: 4400, employerHsa: 1000 }, 2026, {
    state: "CA",
    caHsaConforms: true,
  });
  const b = T.calculate({ wages: 120000, hsa: 4400, employerHsa: 1000 }, 2026, {
    state: "CA",
    caHsaConforms: false,
  });
  assertClose(a.state, b.state, 0.001);
  assertClose(a.audit.stateAgi, 121000, 0.001);
  assertClose(a.audit.federalAgi, 115600, 0.001);
});
test("conditional inputs hide inapplicable elections but retain reserve pricing", () => {
  const c = C.merge(cfg, {
    espp: { enabled: true, holdShares: true, reserveFutureTax: false },
    hsa: { eligible: false },
    retirement: { megaEnabled: false, maxIra: true },
  });
  assert(!UI.compensationFieldVisible(c, "espp.salePrice"));
  assert(!UI.compensationFieldVisible(c, "espp.holdMonths"));
  assert(!UI.compensationFieldVisible(c, "espp.reserveSaleMonths"));
  assert(!UI.compensationFieldVisible(c, "hsa.employee"));
  assert(!UI.compensationFieldVisible(c, "retirement.mega"));
  assert(!UI.compensationFieldVisible(c, "retirement.ira"));
  c.espp.reserveFutureTax = true;
  assert(UI.compensationFieldVisible(c, "espp.salePrice"));
  assert(UI.compensationFieldVisible(c, "espp.reserveSaleMonths"));
});
test("tax bar domain follows income instead of an oversized next bracket", () => {
  const rows = T.bracketRows(
    220000,
    [12400, 50400, 105700, 201775, 256225, 640600],
    [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37],
  );
  const v = taxChartLayout([{ value: 220000 }], rows);
  assert(v.maximum >= 220000);
  assert(v.maximum <= 242000);
});
test("monthly ESPP held lots, delayed sales, and fractional refunds conserve every hub", () => {
  for (const patch of [
    { holdShares: true },
    { holdShares: false, holdMonths: 4 },
    { holdShares: false, holdMonths: 0, employmentEnd: "2026-04-15" },
  ]) {
    const p = C.calculate(C.merge(cfg, { espp: patch })),
      f = C.cashFlow(p);
    for (let month = 1; month <= 12; month++) {
      const selected = F.forMonth(p, f, month),
        base = F.buildFlow(selected.payroll, selected.flow),
        g = F.orderFlow(base);
      assertClose(
        g.summary.remainingCash - g.summary.fundingNeeded,
        f.months[month - 1].spendableCashFlow,
        0.001,
      );
      for (const n of g.nodes.filter((n) => n.kind === "hub"))
        assertClose(
          g.links
            .filter((l) => l.target === n.id)
            .reduce((s, l) => s + l.value, 0),
          g.links
            .filter((l) => l.source === n.id)
            .reduce((s, l) => s + l.value, 0),
          0.001,
          `${month} ${n.id}`,
        );
    }
  }
});
test("monthly tax funding totals reconcile to payments and annual planning settlement", () => {
  const p = C.calculate(C.merge(cfg, { tax: { estimatedPayments: 1200 } })),
    f = C.cashFlow(p);
  for (let month = 1; month <= 12; month++) {
    const { flow } = F.forMonth(p, f, month),
      sum = (key) => flow.taxAttribution.groups.reduce((s, g) => s + g[key], 0),
      m = f.months[month - 1];
    assertClose(
      sum("total"),
      m.cashWithholding +
        m.rsuSellToCover +
        m.estimatedTaxPayments +
        m.taxAdjustment,
      0.001,
    );
    assertClose(sum("balance"), m.taxAdjustment, 0.001);
  }
});
test("after-tax outcome deducts real transfers and tax, never the standard deduction as spending", () => {
  const { taxCashOutcome } = require("../tax-ui");
  const c = C.merge(cfg, {
    bonusPercent: 0,
    retirement: { traditional: 0 },
    hsa: { employee: 0 },
    espp: { enabled: false },
  });
  const p = C.calculate(c),
    f = C.cashFlow(p),
    o = taxCashOutcome(p, f);
  assertClose(o.cash, 93046, 0.001);
  assertClose(o.equity, 8442, 0.001);
  assertClose(o.total, 101488, 0.001);
  const q = C.calculate(C.merge(c, { retirement: { traditional: 24000 } })),
    g = C.cashFlow(q),
    reduced = taxCashOutcome(q, g);
  assertClose(reduced.total, 82972, 0.001);
});
