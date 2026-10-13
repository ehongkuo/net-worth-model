// A non-qualified ESPP purchase spread is taxable wages, but it is ESPP value,
// not RSU equity. The flow summary must count it once (as the ESPP purchase
// benefit) and the tax view must attribute it to ESPP.
const { test, assert, assertClose } = require("./harness");
const C = require("../compensation");
const TaxEngine = require("../tax-engine");
const { buildFlow } = require("../money-flow");

// Lookback at 100 against a 125 purchase FMV with 15% off: price 85, spread 40/share.
function year(espp, grants = []) {
  const p = C.calculate(
    C.merge(C.defaults(), {
      salary: 200000,
      grants,
      espp: {
        enabled: true,
        rate: 0.1,
        offerPrice: 100,
        purchasePrice: 125,
        salePrice: 125,
        holdShares: true,
        ...espp,
      },
    }),
    2026,
  );
  return {
    p,
    summary: buildFlow(p, C.cashFlow(p)).summary,
    groups: TaxEngine.attribute(p.taxes, p).groups,
  };
}
const spreadOf = (p) =>
  p.espp.lots
    .filter((l) => l.purchaseDate.startsWith("2026"))
    .reduce((n, l) => n + l.shares * (125 - 85), 0);
const grant = {
  value: 20000,
  grantPrice: 100,
  start: "2025-12-31",
  months: 12,
  interval: 3,
  saleMode: "hold",
};

for (const holdShares of [true, false])
  test(`non-qualified ESPP spread is counted once in the flow summary (${holdShares ? "hold" : "sell at purchase"})`, () => {
    const q = year({ qualifiedPlan: true, holdShares }, [grant]),
      n = year({ qualifiedPlan: false, holdShares }, [grant]);
    const spread = spreadOf(n.p);
    assert(spread > 1000, "scenario buys shares at a discount");
    assertClose(n.p.esppSpread, spread, 0.01);
    assertClose(n.summary.esppDiscount, spread, 0.01);
    // RSU income and retained RSUs are the grant alone in both plan types.
    assertClose(n.p.rsuGross, 20000, 0.01);
    assertClose(n.summary.rsuIncome, q.summary.rsuIncome, 0.01);
    assertClose(n.summary.totalIncome, q.summary.totalIncome, 0.01);
    assertClose(n.summary.assetAdditions, q.summary.assetAdditions, 0.01);
    // The spread is still taxable wages for a non-qualified plan.
    assertClose(n.p.income.wages - q.p.income.wages, spread, 0.01);
  });

test("tax attribution assigns the non-qualified spread to ESPP, not RSUs", () => {
  const n = year({ qualifiedPlan: false }, [grant]);
  const spread = spreadOf(n.p);
  const g = (id) => n.groups.find((x) => x.id === id);
  assertClose(g("rsu").gross, 20000, 0.01);
  assertClose(g("espp").gross, spread, 0.01);
  assert(g("espp").payroll > 0, "the wage spread carries payroll tax");
  assertClose(
    n.groups.reduce((s, x) => s + x.total, 0),
    n.p.taxes.total,
    0.01,
  );
});

test("earning-pace non-qualified spread stays out of RSU income", () => {
  const input = C.merge(C.defaults(), {
    salary: 200000,
    espp: {
      enabled: true,
      qualifiedPlan: false,
      rate: 0.1,
      offerPrice: 100,
      purchasePrice: 125,
      start: "2026-01-01",
    },
  });
  const p = C.ongoing(input, {});
  assert(p.esppSpread > 0, "pace path produces a spread");
  assertClose(p.rsuGross, 0, 0.01);
  const s = buildFlow(p, C.cashFlow(p)).summary;
  assertClose(s.rsuIncome, 0, 0.01);
  assertClose(s.totalIncome - s.grossCashPay, s.esppDiscount, 0.01);
});
