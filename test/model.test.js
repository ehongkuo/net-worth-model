/**
 * Baseline tests for behaviour that is already correct. These pin the engine's
 * contract so later fixes can't regress it. Correctness fixes add their own
 * files (tax.test.js, retirement.test.js, ...).
 */

const { describe, test, assert, assertEqual, assertClose } = require('./harness');
const { LifetimeModel, deepMerge, DEFAULT_CONFIG } = require('../model');

describe('deepMerge', () => {
  test('merges nested objects without mutating the target', () => {
    const target = { a: 1, nested: { x: 1, y: 2 } };
    const out = deepMerge(target, { nested: { y: 9, z: 3 } });
    assertEqual(out.a, 1);
    assertEqual(out.nested.x, 1);
    assertEqual(out.nested.y, 9);
    assertEqual(out.nested.z, 3);
    assertEqual(target.nested.y, 2, 'source must not mutate target');
  });

  test('replaces arrays rather than merging them', () => {
    const out = deepMerge({ list: [1, 2, 3] }, { list: [9] });
    assertEqual(out.list.length, 1);
    assertEqual(out.list[0], 9);
  });
});

describe('calculateFixedMortgagePayment', () => {
  const m = new LifetimeModel();

  test('matches the standard amortization formula', () => {
    // $300k @ 6% for 30y is a well-known ~$1798.65/mo.
    assertClose(m.calculateFixedMortgagePayment(300000, 0.06, 30), 1798.65, 0.5);
  });

  test('handles a zero interest rate as straight-line', () => {
    assertClose(m.calculateFixedMortgagePayment(360000, 0, 30), 1000, 1e-6);
  });
});

describe('calculateMortgagePayment (annual amortization)', () => {
  const m = new LifetimeModel();

  test('a year of payments reduces the balance and splits into interest + principal', () => {
    const payment = m.calculateFixedMortgagePayment(300000, 0.06, 30);
    const y = m.calculateMortgagePayment(300000, 0.06, payment);
    assert(y.newBalance < 300000, 'balance should drop');
    assertClose(y.interest + y.principalPaid, payment * 12, 1, 'interest + principal ≈ 12 payments');
    assertClose(300000 - y.principalPaid, y.newBalance, 1e-6, 'principal paid reduces balance');
  });
});

describe('calculateTax', () => {
  const m = new LifetimeModel();
  const tax = (income, married = false) => m.calculateTax(income, married, 0, 0.03);

  test('is zero for non-positive income', () => {
    assertEqual(tax(0), 0);
    assertEqual(tax(-5000), 0);
  });

  test('is monotonically increasing in income', () => {
    assert(tax(50000) < tax(100000));
    assert(tax(100000) < tax(250000));
    assert(tax(250000) < tax(1000000));
  });

  test('married filing pays no more than single at the same income (wider brackets)', () => {
    for (const income of [80000, 200000, 500000]) {
      assert(tax(income, true) <= tax(income, false), `married ≤ single at ${income}`);
    }
  });
});

describe('simulate', () => {
  test('returns one row per projection year, ages advancing from the start age', () => {
    const m = new LifetimeModel();
    const results = m.simulate();
    assertEqual(results.length, DEFAULT_CONFIG.projectionYears + 1);
    assertEqual(results[0].age, DEFAULT_CONFIG.age);
    assertEqual(results[results.length - 1].age, DEFAULT_CONFIG.age + DEFAULT_CONFIG.projectionYears);
  });

  test('net worth conservation: contributions + spendable = gross - taxes each year', () => {
    const m = new LifetimeModel();
    const r = m.simulate()[0];
    const spendable = r.netCashFlow + r.expenses.total; // cash flow before spending
    const accountedFor = r.savings.total + spendable;
    assertClose(accountedFor, r.income.gross - r.taxes, 1, 'no money created or lost');
  });
});
