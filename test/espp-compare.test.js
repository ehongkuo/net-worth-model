const { test, assert } = require("./harness");
const Scenario = require("../scenario");
const Projection = require("../projection");
const Compensation = require("../compensation");

function compare(espp) {
  const s = Scenario.defaults();
  s.employerPlan.espp = { ...s.employerPlan.espp, enabled: true, ...espp };
  const r = Projection.calculate(s);
  return Compensation.esppSaleComparison(
    Scenario.engineInput(s),
    r.ongoing.flow.taxes,
    r.ongoing.payroll.earningPace.asOf,
  );
}
const near = (a, b) => Math.abs(a - b) < 0.01;

test("sale comparison covers sell-now, one-year and qualifying horizons", () => {
  const x = compare({ offerPrice: 100, purchasePrice: 120, salePrice: 130 });
  assert(x && x.scenarios.map((v) => v.id).join() === "now,year,qualify");
  const [now, year, qualify] = x.scenarios;
  assert(now.saleDate === x.lot.purchaseDate && now.price === 120);
  assert(year.saleDate > x.lot.purchaseDate && !year.qualified);
  assert(qualify.qualified && qualify.longGain > 0);
  // Disqualifying sales report the purchase-date spread as ordinary income.
  const spread = x.lot.shares * 120 - x.lot.cost;
  assert(near(now.ordinary, spread) && near(year.ordinary, spread));
  // Qualifying ordinary income is capped at the offering-date discount.
  assert(near(qualify.ordinary, x.lot.shares * 100 * x.lot.discount));
});
test("each horizon's tax is the household tax increase and the best is the highest after-tax cash", () => {
  const x = compare({ offerPrice: 100, purchasePrice: 120, salePrice: 130 });
  for (const v of x.scenarios) {
    assert(v.tax > 0 && v.tax < v.ordinary + v.shortGain + v.longGain);
    assert(near(v.afterTax, v.proceeds - v.tax));
  }
  const best = x.scenarios.reduce((a, b) => (b.afterTax > a.afterTax ? b : a));
  assert(x.best === best.id);
});
test("sale comparison is empty when ESPP is off", () => {
  const s = Scenario.defaults();
  const r = Projection.calculate(s);
  assert(
    Compensation.esppSaleComparison(
      Scenario.engineInput(s),
      r.ongoing.flow.taxes,
      r.ongoing.payroll.earningPace.asOf,
    ) === null,
  );
});
