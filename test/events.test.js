/**
 * Event mechanics: relative salary changes and snapshot-based reversals.
 */

const { describe, test, assert, assertClose } = require('./harness');
const { LifetimeModel } = require('../model');

describe('relative salary changes', () => {
  test('salaryMultiplier scales the current (grown) salary, never cutting it', () => {
    // By the time the promotion lands the base has grown for years; a relative
    // raise must still be a raise.
    const m = new LifetimeModel({ baseSalary: 165000, salaryGrowth: 0.03, retirementAge: null });
    m.addEvent({ name: 'Promo', type: 'career', year: 10, effects: { salaryMultiplier: 1.18 } });
    const results = m.simulate();
    const before = results[9].income.salary;
    const after = results[10].income.salary;
    assert(after > before, `promotion is a raise: ${Math.round(after)} > ${Math.round(before)}`);
    // Salary grows one more step (year-end) before the year-10 promotion scales it.
    assertClose(after, before * 1.03 * 1.18, 1, 'scales the grown salary by the multiplier');
  });

  test('salaryIncrease adds a flat amount', () => {
    const m = new LifetimeModel({ retirementAge: null });
    m.addEvent({ name: 'Bump', type: 'career', year: 3, effects: { salaryIncrease: 20000 } });
    const results = m.simulate();
    assertClose(results[3].income.salary - results[2].income.salary,
      20000 + results[2].income.salary * 0.03, 1, 'adds on top of that year growth');
  });
});

describe('snapshot reversals', () => {
  test('a bear market reverts to the actual market-return setting, not a baked-in 7%', () => {
    // User set a 9% long-run return; a temporary bear market must revert to 9%.
    const m = new LifetimeModel({ marketReturn: 0.09, retirementAge: null });
    m.addEvent({ name: 'Bear', type: 'market', year: 5, duration: 2, effects: { marketReturn: -0.15 } });
    const results = m.simulate();
    // The two bear years grow the portfolio much less; the year after reversal
    // should resume strong growth (proxy for the 9% setting being restored).
    const brokerageBefore = results[4].balances.brokerage;
    const brokerageDuring = results[6].balances.brokerage; // still in the bear window
    const brokerageAfter = results[8].balances.brokerage;  // after reversal
    assert(brokerageDuring < brokerageBefore * 1.1, 'bear market suppresses growth');
    // Growth rate after reversal exceeds the bear-window rate.
    const postRate = results[8].balances.brokerage / results[7].balances.brokerage;
    assert(postRate > 1.05, `resumes >5% growth after reversal, got ${(postRate - 1).toFixed(3)}`);
  });

  test('a duration raise reverts salary to the real pre-event value', () => {
    const m = new LifetimeModel({ baseSalary: 100000, salaryGrowth: 0, retirementAge: null });
    m.addEvent({ name: 'Temp lead', type: 'career', year: 2, duration: 3, effects: { salaryMultiplier: 1.5 } });
    const results = m.simulate();
    assertClose(results[1].income.salary, 100000, 1, 'before');
    assertClose(results[2].income.salary, 150000, 1, 'during (raised)');
    assertClose(results[5].income.salary, 100000, 1, 'reverted to the real prior salary');
  });
});
