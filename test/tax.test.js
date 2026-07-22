/**
 * Tax-correctness tests. These encode the fixes to the tax engine:
 *   - a standard deduction is applied before federal/state brackets
 *   - FICA is levied on gross wages, not on post-401k income, and not on
 *     non-wage income (rental, windfalls)
 *   - inheritances / gifts are not taxed as income
 *   - California state tax is progressive, not a flat rate
 */

const { describe, test, assert, assertClose } = require('./harness');
const { LifetimeModel } = require('../model');

const m = new LifetimeModel();
const SS_WAGE_BASE = 176100;

// Convenience wrappers around the structured tax API.
const tax = (p) => m.calculateTax({ yearOffset: 0, inflationRate: 0, ...p });
const parts = (p) => m.taxBreakdown({ yearOffset: 0, inflationRate: 0, ...p });

describe('standard deduction', () => {
  test('income at or below the standard deduction owes no income tax', () => {
    // Below both the federal ($15k) and CA ($5.5k) standard deductions.
    const b = parts({ otherOrdinaryIncome: 5000, married: false });
    assertClose(b.federal, 0, 1e-6, 'federal zero below std deduction');
    assertClose(b.state, 0, 1e-6, 'state zero below CA std deduction');
  });

  test('federal tax applies only to income above the standard deduction', () => {
    // $15,000 std deduction (single). $65k income → $50k taxed.
    const b = parts({ otherOrdinaryIncome: 65000, married: false });
    const manual = m.federalTax(65000 - 15000, false, 0, 0);
    assertClose(b.federal, manual, 1, 'federal taxed on income minus std deduction');
  });
});

describe('FICA', () => {
  test('is charged on gross wages, unaffected by 401k/HSA pre-tax deductions', () => {
    const withDeduction = parts({ wages: 150000, preTaxDeductions: 30000 });
    const without = parts({ wages: 150000, preTaxDeductions: 0 });
    assertClose(withDeduction.fica, without.fica, 1e-6, '401k does not reduce FICA');
  });

  test('is not charged on non-wage income (rental, windfalls)', () => {
    const b = parts({ otherOrdinaryIncome: 200000, wages: 0 });
    assertClose(b.fica, 0, 1e-6, 'rental/other income owes no FICA');
  });

  test('respects the Social Security wage base cap', () => {
    const b = parts({ wages: 500000 });
    const ss = SS_WAGE_BASE * 0.062;
    const med = 500000 * 0.0145;
    const addlMed = (500000 - 200000) * 0.009; // single threshold
    assertClose(b.fica, ss + med + addlMed, 1, 'SS capped, Medicare uncapped + additional');
  });

  test('each spouse gets their own SS wage base', () => {
    // Two earners at the cap should pay SS twice, not on a single combined cap.
    const b = parts({ wages: SS_WAGE_BASE, spouseWages: SS_WAGE_BASE, married: true });
    const ssBoth = 2 * SS_WAGE_BASE * 0.062;
    const med = 2 * SS_WAGE_BASE * 0.0145;
    // combined wages exceed the $250k married additional-Medicare threshold
    const addl = (2 * SS_WAGE_BASE - 250000) * 0.009;
    assertClose(b.fica, ssBoth + med + addl, 1);
  });
});

describe('non-taxable windfalls', () => {
  test('an inheritance adds nothing to the tax bill', () => {
    const base = tax({ wages: 165000 });
    const withInheritance = tax({ wages: 165000, taxFreeIncome: 200000 });
    assertClose(withInheritance, base, 1e-6, 'inheritance is not income-taxed');
  });

  test('simulate: an inheritance event does not spike taxes that year', () => {
    const model = new LifetimeModel();
    const baseline = model.simulate();
    model.addEvent({ name: 'Inheritance', type: 'windfall', year: 5, effects: { oneTimeIncomeTaxFree: 200000 } });
    const withEvent = model.simulate();
    assertClose(withEvent[5].taxes, baseline[5].taxes, 1, 'no phantom tax on inheritance');
    assert(withEvent[5].netWorth > baseline[5].netWorth + 150000, 'windfall lands in net worth');
  });
});

describe('progressive California tax', () => {
  test('effective CA rate rises with income', () => {
    const low = parts({ otherOrdinaryIncome: 40000 });
    const high = parts({ otherOrdinaryIncome: 400000 });
    const lowRate = low.state / 40000;
    const highRate = high.state / 400000;
    assert(highRate > lowRate, `CA is progressive: ${highRate} > ${lowRate}`);
  });

  test('top marginal income sees a CA rate well above the old flat 9.3%', () => {
    const b = parts({ otherOrdinaryIncome: 2000000 });
    assert(b.state / 2000000 > 0.10, 'high earners exceed the old flat rate');
  });
});
