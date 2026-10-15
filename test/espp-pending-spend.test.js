const { test, assert, assertClose, assertEqual } = require("./harness");
const Scenario = require("../scenario"),
  Projection = require("../projection");

// Aug-Jan offerings leave ESPP cash pending at year end. Salary doubles in
// 2027 so that year has no deficit and no further withdrawals.
function run(housing, espp = {}) {
  const s = Scenario.defaults();
  Object.assign(s.compensation, { salary: 200000, salaryGrowth: 1 });
  Object.assign(s.employerPlan.espp, {
    enabled: true,
    rate: 0.15,
    start: "2026-08-01",
    periodMonths: 6,
    offerPrice: 100,
    purchasePrice: 120,
    salePrice: 120,
    holdShares: true,
    ...espp,
  });
  s.projection.startingBalances.pretax401k = 200000;
  s.projection.monthlyExpenses.housing = housing;
  return Projection.calculate(s).rows;
}

test("spending pending ESPP cash removes the shares it would have bought", () => {
  const spend = run(11000),
    none = run(0);
  const spent = none[1].balances.esppPending - spend[1].balances.esppPending;
  assert(spent > 1000, "the 2026 deficit draws pending ESPP cash");
  // Pending cash is used before the 401(k).
  assertClose(spend[1].balances.pretax401k, none[1].balances.pretax401k, 0.01);
  // In 2027 the January purchase happens. Spent cash first replaces its small
  // fractional-share refund, then the shares it would have bought are gone,
  // valued at purchase price (120) over cost (100 × 85% lookback).
  const jan = none[2].payroll.espp.lots.find((l) =>
    l.purchaseDate.startsWith("2027-01"),
  );
  assertClose(
    spend[2].balances.companyEquity,
    none[2].balances.companyEquity - ((spent - jan.refund) * 120) / 85,
    0.5,
  );
  // The withdrawal is settled, so later pending balances match exactly.
  assertClose(
    spend[2].balances.esppPending,
    none[2].balances.esppPending,
    0.01,
  );
});

// At $500k the Aug-Jan offering hits the $25,000 FMV limit, so part of the
// pending cash comes back as a refund at purchase.
function capped(housing) {
  const s = Scenario.defaults();
  Object.assign(s.compensation, { salary: 500000, salaryGrowth: 1 });
  Object.assign(s.employerPlan.espp, {
    enabled: true,
    rate: 0.15,
    start: "2026-08-01",
    periodMonths: 6,
    offerPrice: 100,
    purchasePrice: 120,
    salePrice: 120,
    holdShares: true,
  });
  s.projection.startingBalances.pretax401k = 500000;
  s.projection.monthlyExpenses.housing = housing;
  return Projection.calculate(s).rows;
}

test("spent pending ESPP cash comes out of the refund, not back as cash", () => {
  const low = capped(20000),
    high = capped(24000);
  const spent = low[1].balances.esppPending - high[1].balances.esppPending;
  assert(spent > 10000, "the 2026 deficit draws pending ESPP cash");
  assert(
    spent < high[2].payroll.espp.refunds,
    "the purchase refund covers the spent cash",
  );
  // The refund absorbs the withdrawal, so the shares bought are unchanged.
  assertClose(
    high[2].balances.companyEquity,
    low[2].balances.companyEquity,
    0.01,
  );
  // Net worth falls by exactly the extra spending: spent cash isn't refunded.
  const extra =
    high[1].expenses - low[1].expenses + high[2].expenses - low[2].expenses;
  assertClose(low[2].netWorth - high[2].netWorth, extra, 0.01);
});

test("shares sold right after purchase don't bring back spent ESPP cash", () => {
  const drop = (espp) => {
    const none = run(0, espp),
      spend = run(11000, espp);
    return none[2].netWorth - spend[2].netWorth;
  };
  const sold = { holdShares: false, holdMonths: 0 };
  // The sold shares' proceeds are cash that was already spent, so net worth
  // falls by the same amount whether the shares are held or sold.
  assertClose(drop(sold), drop({}), 1);
  assertEqual(run(11000, sold)[2].balances.companyEquity, 0);
});
