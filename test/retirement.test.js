/**
 * Retirement, Social Security, and drawdown tests.
 */

const { describe, test, assert, assertClose } = require('./harness');
const { LifetimeModel } = require('../model');

// A short-horizon model that retires early so drawdown is exercised quickly.
function retiringModel(overrides = {}) {
  return new LifetimeModel({
    age: 60,
    projectionYears: 20,
    retirementAge: 65,
    socialSecurityAnnual: 40000,
    socialSecurityStartAge: 67,
    ...overrides
  });
}

describe('retirement transition', () => {
  test('employment income and contributions stop at the retirement age', () => {
    const results = retiringModel().simulate();
    const working = results.find(r => r.age === 64);
    const retired = results.find(r => r.age === 66);

    assert(working.state.employed, 'employed at 64');
    assert(working.income.salary > 0, 'has salary at 64');
    assert(working.savings.total > 0, 'contributing at 64');

    assert(!retired.state.employed, 'not employed at 66');
    assert(retired.state.retired, 'flagged retired at 66');
    assertClose(retired.income.salary, 0, 1e-6, 'no salary in retirement');
    assertClose(retired.savings.total, 0, 1e-6, 'no contributions in retirement');
  });
});

describe('Social Security', () => {
  test('pays nothing before the start age and a positive nominal benefit after', () => {
    const results = retiringModel().simulate();
    assertClose(results.find(r => r.age === 66).income.socialSecurity, 0, 1e-6, 'none at 66');
    const at70 = results.find(r => r.age === 70).income.socialSecurity;
    assert(at70 > 40000, `SS inflated above nominal $40k, got ${Math.round(at70)}`);
  });

  test('is not subject to FICA and only 85% is federally taxable', () => {
    const m = retiringModel();
    // Pure SS year: no wages, so FICA must be zero.
    const b = m.taxBreakdown({ federalOnlyOrdinaryIncome: 0.85 * 40000, yearOffset: 0, inflationRate: 0 });
    assertClose(b.fica, 0, 1e-6, 'no FICA on Social Security');
    assertClose(b.state, 0, 1e-6, 'CA does not tax Social Security');
  });
});

describe('drawdown waterfall', () => {
  test('a retiree with no other income spends down net worth', () => {
    // High spending, small Social Security -> must draw down.
    const m = retiringModel({ socialSecurityAnnual: 20000 });
    const results = m.simulate();
    const atRetire = results.find(r => r.age === 65).netWorth;
    const atEnd = results[results.length - 1].netWorth;
    assert(atEnd < atRetire, `net worth declines in retirement: ${Math.round(atEnd)} < ${Math.round(atRetire)}`);
  });

  test('taxable brokerage is drawn before Roth', () => {
    const m = retiringModel({ socialSecurityAnnual: 0, brokerage: 300000, rothAccounts: 300000 });
    const state = { balances: { brokerage: 300000, pretax401k: 0, traditionalIRA: 0, rothAccounts: 300000, hsa: 0, cash: 0 }, basis: { brokerage: 300000 } };
    const out = m.drawDown(state, 100000);
    assertClose(out.drawn, 100000, 1e-6);
    assertClose(state.balances.brokerage, 200000, 1e-6, 'brokerage tapped first');
    assertClose(state.balances.rothAccounts, 300000, 1e-6, 'Roth untouched while brokerage remains');
    assertClose(out.taxableWithdrawal, 0, 1e-6, 'brokerage draw is not ordinary income here');
  });

  test('pre-tax withdrawals count as taxable ordinary income', () => {
    const m = new LifetimeModel();
    const state = { balances: { brokerage: 0, pretax401k: 200000, traditionalIRA: 0, rothAccounts: 0, hsa: 0, cash: 0 }, basis: { brokerage: 0 } };
    const out = m.drawDown(state, 50000);
    assertClose(out.taxableWithdrawal, 50000, 1e-6, '401k draw is ordinary income');
  });

  test('reports a shortfall once every account is exhausted', () => {
    const m = new LifetimeModel();
    const state = { balances: { brokerage: 10000, pretax401k: 0, traditionalIRA: 0, rothAccounts: 0, hsa: 0, cash: 0 }, basis: { brokerage: 10000 } };
    const out = m.drawDown(state, 25000);
    assertClose(out.drawn, 10000, 1e-6);
    assertClose(out.shortfall, 15000, 1e-6);
  });
});

describe('accumulation phase is unchanged', () => {
  test('money conservation still holds during working years', () => {
    const m = new LifetimeModel();
    const r = m.simulate()[10]; // age 35, still working
    const spendable = r.netCashFlow + r.expenses.total;
    assertClose(r.savings.total + spendable, r.income.gross - r.taxes, 1);
  });
});
