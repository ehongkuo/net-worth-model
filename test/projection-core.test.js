const { test, assert, assertClose } = require("./harness");
const S = require("../scenario");
let P;
try {
  P = require("../projection");
} catch {}
const fixture = () => {
  const s = S.defaults();
  s.compensation.salary = 120000;
  s.compensation.salaryGrowth = 0;
  s.projection.years = 3;
  s.projection.marketReturn = 0;
  s.projection.inflation = 0;
  s.projection.startingBalances.cash = 10000;
  return s;
};
test("all three views consume the same first-year result and scenario round-trips", () => {
  const s = fixture(),
    before = S.serialize(s),
    a = P.calculate(s),
    b = P.calculate(JSON.parse(before));
  assert(JSON.stringify(a) === JSON.stringify(b));
  assert(S.serialize(s) === before);
  assertClose(a.rows[0].netWorth, 10000);
  assertClose(a.rows[1].payroll.salary, 120000);
  assertClose(a.rows[1].netCashFlow, a.rows[1].flow.netCashFlow);
  assertClose(a.rows[1].taxes.total, a.rows[1].flow.taxes.total);
  assertClose(
    a.rows[1].flow.months.reduce((n, m) => n + m.netCashFlow, 0),
    a.rows[1].netCashFlow,
    0.02,
  );
  assertClose(a.rows[1].netWorth - 10000, 120000 - a.rows[1].taxes.total, 0.02);
});
test("contributions move assets without disappearing and filing status is preserved", () => {
  const s = fixture();
  s.taxProfile.settings.filing = "married";
  s.employerPlan.retirement.traditional = 24000;
  s.employerPlan.retirement.employerAnnual = 5000;
  s.employerPlan.hsa.employee = 3000;
  const r = P.calculate(s).rows[1];
  assert(r.payroll.taxes.audit.settings.filing === "married");
  assertClose(r.balances.pretax401k, 29000);
  assertClose(r.balances.hsa, 3000);
  assertClose(r.netWorth - 10000, 125000 - r.taxes.total, 0.02);
});
test("retirement stops employment and export retains starting balances and expenses", () => {
  const s = fixture();
  s.projection.retirementAge = s.taxProfile.age + 1;
  s.projection.monthlyExpenses.housing = 1000;
  const rows = P.calculate(s).rows;
  assertClose(rows[2].payroll.salary, 0);
  assertClose(rows[2].payroll.contributions.totalEmployee, 0);
  assertClose(rows[1].expenses, 12000);
  assert(rows.every((r) => Number.isFinite(r.netWorth)));
});
