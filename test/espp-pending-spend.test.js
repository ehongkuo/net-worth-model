const { test, assert, assertClose } = require("./harness");
const Scenario = require("../scenario"),
  Projection = require("../projection");

// Aug-Jan offerings leave ESPP cash pending at year end. Salary doubles in
// 2027 so that year has no deficit and no further withdrawals.
function run(housing) {
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
  // In 2027 the January purchase happens; shares bought with spent cash are
  // gone, valued at purchase price (120) over cost (100 × 85% lookback).
  assertClose(
    spend[2].balances.companyEquity,
    none[2].balances.companyEquity - (spent * 120) / 85,
    0.5,
  );
  // The withdrawal is settled, so later pending balances match exactly.
  assertClose(
    spend[2].balances.esppPending,
    none[2].balances.esppPending,
    0.01,
  );
});
