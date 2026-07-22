/**
 * Cumulative inflation factor, used to render figures in today's dollars.
 */

const { describe, test, assertClose } = require('./harness');
const { LifetimeModel } = require('../model');

describe('inflationFactor', () => {
  test('is 1 in year 0 and compounds at the inflation rate', () => {
    const m = new LifetimeModel({ inflation: 0.03 });
    const results = m.simulate();
    assertClose(results[0].inflationFactor, 1, 1e-9, 'year 0 is today');
    assertClose(results[10].inflationFactor, Math.pow(1.03, 10), 1e-9);
    assertClose(results[30].inflationFactor, Math.pow(1.03, 30), 1e-9);
  });

  test('deflating a nominal figure yields a smaller real figure under inflation', () => {
    const m = new LifetimeModel({ inflation: 0.03 });
    const r = m.simulate()[30];
    const real = r.netWorth / r.inflationFactor;
    assertClose(real, r.netWorth / Math.pow(1.03, 30), 1);
    // With positive inflation, today's-dollars net worth is below nominal.
    if (r.netWorth > 0) assertClose(real < r.netWorth, true, 0, 'real below nominal');
  });

  test('zero inflation leaves nominal and real equal', () => {
    const m = new LifetimeModel({ inflation: 0 });
    const results = m.simulate();
    assertClose(results[40].inflationFactor, 1, 1e-9);
  });
});
