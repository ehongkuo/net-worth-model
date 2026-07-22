/**
 * Contribution-limit inflation and dead-config removal.
 */

const { describe, test, assert, assertClose } = require('./harness');
const { LifetimeModel, DEFAULT_CONFIG } = require('../model');

describe('contribution limits', () => {
  test('rise with inflation over the projection', () => {
    const m = new LifetimeModel({ inflation: 0.03, retirementAge: null });
    const results = m.simulate();
    const y0 = results[0].savings.pretax401k;
    const y10 = results[10].savings.pretax401k;
    assert(y10 > y0, 'nominal 401k contribution grows');
    assertClose(y10, y0 * Math.pow(1.03, 10), 1, 'grows at the inflation rate');
  });

  test('stay flat in nominal terms when inflation is zero', () => {
    const m = new LifetimeModel({ inflation: 0, retirementAge: null });
    const results = m.simulate();
    assertClose(results[20].savings.pretax401k, results[0].savings.pretax401k, 1e-6);
  });
});

describe('config hygiene', () => {
  test('the unused rsuTaxRate field is gone', () => {
    assert(!('rsuTaxRate' in DEFAULT_CONFIG), 'rsuTaxRate should not exist');
  });
});
