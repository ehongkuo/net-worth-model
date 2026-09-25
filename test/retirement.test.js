const { test, assert, assertClose } = require("./harness");
const S = require("../scenario"),
  P = require("../projection");
function fixture() {
  const s = S.defaults();
  s.taxProfile.age = 65;
  s.taxProfile.settings.state = "none";
  s.projection.years = 3;
  s.projection.retirementAge = 65;
  s.projection.marketReturn = 0;
  s.projection.inflation = 0;
  s.projection.monthlyExpenses.housing = 2000;
  return s;
}
test("retirement draws cash, brokerage and then pretax assets while preserving Roth", () => {
  const s = fixture();
  s.projection.startingBalances = {
    cash: 12000,
    brokerage: 24000,
    pretax401k: 200000,
    traditionalIRA: 0,
    rothAccounts: 100000,
    hsa: 0,
  };
  const rows = P.calculate(s).rows;
  assertClose(rows[1].balances.cash, 0);
  assertClose(rows[1].balances.brokerage, 12000);
  assertClose(rows[1].balances.rothAccounts, 100000);
  assertClose(rows[2].balances.brokerage, 0);
  assert(rows[3].taxes.total > 0);
  assertClose(rows[3].taxes.fica, 0);
  assertClose(rows[3].balances.rothAccounts, 100000);
  for (const r of rows.slice(1))
    assertClose(
      r.flow.months.reduce((n, m) => n + m.netCashFlow, 0),
      r.netCashFlow,
      0.01,
    );
});
test("unfunded retirement expenses remain visible and assets never become negative", () => {
  const s = fixture(),
    r = P.calculate(s).rows[1];
  assertClose(r.shortfall, 24000);
  assertClose(r.netWorth, 0);
  assert(Object.values(r.balances).every((v) => v >= 0));
});
test("Social Security starts at the configured age with no payroll taxes", () => {
  const s = fixture();
  s.projection.socialSecurityAnnual = 40000;
  s.projection.socialSecurityStartAge = 66;
  const rows = P.calculate(s).rows;
  assertClose(rows[1].socialSecurity, 0);
  assertClose(rows[2].socialSecurity, 40000);
  assertClose(rows[2].taxes.fica, 0);
});
