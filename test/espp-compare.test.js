const { test, assert } = require("./harness");
const Scenario = require("../scenario");
const Projection = require("../projection");
const Compensation = require("../compensation");

function run(espp, scenario = {}) {
  const s = Scenario.defaults();
  Object.assign(s.compensation, { salary: 165000 }, scenario);
  s.employerPlan.espp = { ...s.employerPlan.espp, enabled: true, ...espp };
  const r = Projection.calculate(s);
  const row = r.rows[1];
  const x = Compensation.esppSaleComparison(
    Scenario.engineInput(s),
    r.ongoing.payroll,
    { asOf: r.ongoing.payroll.earningPace.asOf, lots: row.payroll.espp.lots },
  );
  return { x, ledger: row.payroll.espp.lots };
}
const near = (a, b, tol = 0.01) => Math.abs(a - b) < tol;
const prices = { offerPrice: 100, purchasePrice: 120, salePrice: 130 };

test("compared purchase is the engine's ledger lot (date, shares, cost)", () => {
  const { x, ledger } = run(prices);
  const match = ledger.find((l) => l.grantDate === x.lot.grantDate);
  assert(match, "ledger lot exists for the current offering");
  assert(x.lot.purchaseDate === match.purchaseDate);
  assert(near(x.lot.shares, match.shares) && near(x.lot.cost, match.cost));
});
test("second purchase in a year respects the remaining $25,000 FMV room", () => {
  const { x, ledger } = run(
    { ...prices, rate: 0.15, fractional: false },
    { salary: 200000 },
  );
  const year = x.lot.purchaseDate.slice(0, 4);
  const used = ledger
    .filter((l) => l.purchaseDate.slice(0, 4) === year)
    .reduce((n, l) => n + l.shares * l.grantPrice, 0);
  assert(used <= 25000 + 0.01, `FMV used ${used}`);
});
test("sale comparison covers sell-now, one-year and qualifying horizons", () => {
  const { x } = run(prices);
  assert(x.scenarios.map((v) => v.id).join() === "now,year,qualify");
  const [now, year, qualify] = x.scenarios;
  assert(now.saleDate === x.lot.purchaseDate && now.price === 120);
  assert(year.saleDate > x.lot.purchaseDate && !year.qualified);
  assert(qualify.qualified && qualify.longGain > 0);
  const spread = x.lot.shares * 120 - x.lot.cost;
  assert(near(now.ordinary, spread) && near(year.ordinary, spread));
  assert(near(qualify.ordinary, x.lot.shares * 100 * x.lot.discount));
});
test("each horizon's tax is the household tax increase and the best is the highest after-tax cash", () => {
  const { x } = run(prices);
  for (const v of x.scenarios) {
    assert(v.tax > 0 && v.tax < v.ordinary + v.shortGain + v.longGain);
    assert(near(v.afterTax, v.proceeds - v.tax));
  }
  const best = x.scenarios.reduce((a, b) => (b.afterTax > a.afterTax ? b : a));
  assert(x.best === best.id);
});
test("a sale fee lowers proceeds and gain in every column", () => {
  const plain = run(prices).x,
    fee = run({ ...prices, fee: 25 }).x;
  plain.scenarios.forEach((v, i) => {
    assert(near(fee.scenarios[i].proceeds, v.proceeds - 25));
    assert(fee.scenarios[i].afterTax < v.afterTax);
  });
});
test("non-qualified plan: no sale ordinary income, profit over purchase value", () => {
  const { x } = run({ ...prices, qualifiedPlan: false });
  assert(!x.qualifiedPlan);
  for (const v of x.scenarios) {
    assert(v.ordinary === 0 && !v.qualified);
    assert(near(v.profit, v.afterTax - x.lot.shares * 120));
  }
});
test("identical outcomes report no best horizon", () => {
  const { x } = run({
    offerPrice: 120,
    purchasePrice: 120,
    salePrice: 120,
    qualifiedPlan: false,
  });
  assert(x.best === null);
});
test("sale comparison is empty when ESPP is off", () => {
  const s = Scenario.defaults();
  const r = Projection.calculate(s);
  assert(
    Compensation.esppSaleComparison(
      Scenario.engineInput(s),
      r.ongoing.payroll,
      {
        asOf: r.ongoing.payroll.earningPace.asOf,
      },
    ) === null,
  );
});
