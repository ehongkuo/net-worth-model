const {
  describe,
  test,
  assert,
  assertClose,
  assertEqual,
} = require("./harness");
const C = require("../compensation");
const config = (patch = {}) => C.merge(C.defaults(), patch);
describe("compensation and cash flow", () => {
  test("published 2026 limits are independent of projection growth", () => {
    const l = C.limits(2026, { limitGrowth: 0.1 });
    assertEqual(l.deferral, 24500);
    assertEqual(l.total401k, 72000);
    assertEqual(l.hsaSingle, 4400);
    assertEqual(l.hsaFamily, 8750);
    assertEqual(l.ssBase, 184500);
  });
  test("future limits are rounded projections; fixed thresholds stay fixed", () => {
    const l = C.limits(2036, { limitGrowth: 0.03, wageGrowth: 0.04 });
    assert(l.deferral > 24500);
    assertEqual(l.deferral % 500, 0);
    assertEqual(l.espp, 25000);
    assertEqual(l.additionalMedicare.single, 200000);
    assertEqual(
      C.limits(2036, { limitGrowth: 0, wageGrowth: 0 }).deferral,
      24500,
    );
  });
  test("employer match reduces mega backdoor room, never paycheck cash", () => {
    const c = config({
      retirement: {
        traditional: 24500,
        mega: 90000,
        employerAnnual: 10000,
        megaEnabled: true,
      },
    });
    const r = C.calculate(c, 2026);
    assertClose(r.contributions.mega, 37500);
    assertClose(r.contributions.employer, 10000);
    assert(r.warnings.some((w) => w.includes("capped")));
  });
  test("traditional and Roth share a deferral limit", () => {
    const r = C.calculate(
      config({ retirement: { traditional: 20000, roth: 10000 } }),
      2026,
    );
    assertClose(r.contributions.traditional + r.contributions.roth, 24500);
  });
  test("payroll HSA reduces federal payroll wages but not CA income", () => {
    const a = C.calculate(
      config({ salary: 100000, hsa: { employee: 0 } }),
      2026,
    );
    const b = C.calculate(
      config({ salary: 100000, hsa: { employee: 4000, payroll: true } }),
      2026,
    );
    assertClose(a.taxes.state, b.taxes.state);
    assertClose(a.taxes.fica - b.taxes.fica, 4000 * 0.0765);
    assert(b.taxes.federal < a.taxes.federal);
  });
  test("HSA employer money consumes the family limit without reducing cash", () => {
    const r = C.calculate(
      config({ hsa: { coverage: "family", employee: 8750, employer: 2000 } }),
      2026,
    );
    assertClose(r.contributions.hsa, 6750);
    assertClose(r.contributions.hsaEmployer, 2000);
  });
  test("monthly net cash reconciles to annual withholding and tax reserve", () => {
    const r = C.calculate(
      config({ salary: 165000, bonusPercent: 0.1, espp: { enabled: true } }),
      2026,
    );
    const sum = (key) => r.months.reduce((s, m) => s + m[key], 0);
    assertClose(sum("bankCash"), r.bankCash);
    assertClose(r.bankCash - r.taxBalance, r.afterTaxCash);
    assertClose(sum("salary"), 165000);
    assertClose(sum("bonus"), 16500);
  });
  test("RSUs vest by grant schedule; held shares are not spendable income", () => {
    const c = config({
      grants: [
        {
          name: "Grant",
          value: 40000,
          grantPrice: 100,
          start: "2025-12-31",
          months: 48,
          cliff: 12,
          interval: 3,
          sell: false,
        },
      ],
    });
    const r = C.calculate(c, 2026);
    assertClose(r.rsuGross, 10000);
    assertClose(r.rsuCash, 0);
    assertClose(r.stockAssets, 10000);
    assertEqual(r.months.filter((m) => m.rsu > 0).length, 1);
  });
  test("a twelve-month cliff occurs on its anniversary, never in the prior tax year", () => {
    const c = config({
      grants: [
        {
          value: 40000,
          start: "2026-01-01",
          months: 48,
          cliff: 12,
          interval: 3,
          sell: true,
        },
      ],
    });
    assertClose(C.calculate(c, 2026).rsuGross, 0);
    assertClose(C.calculate(c, 2027).months[0].rsu, 10000);
  });
  test("employer HSA is subject to California SDI", () => {
    const a = C.calculate(config(), 2026);
    const b = C.calculate(config({ hsa: { employer: 1000 } }), 2026);
    assertClose(b.taxes.sdi - a.taxes.sdi, 13);
  });
  test("ESPP cap refunds unused principal and sale gain is not subject to FICA", () => {
    const c = config({
      salary: 500000,
      espp: {
        enabled: true,
        rate: 0.15,
        shareCap: 10,
        offerPrice: 100,
        purchasePrice: 100,
        salePrice: 100,
      },
    });
    const r = C.calculate(c, 2026);
    assertClose(r.espp.ordinary, 300);
    assert(r.espp.refunds > 0);
    assertClose(r.espp.proceeds + r.espp.refunds - r.espp.contributions, 300);
    const no = C.calculate(config({ salary: 500000 }), 2026);
    assertClose(r.taxes.fica, no.taxes.fica);
  });
  test("ESPP holding periods use both grant and purchase dates", () => {
    const lot = {
      grantDate: "2026-01-01",
      purchaseDate: "2026-06-30",
      shares: 10,
      cost: 850,
      grantPrice: 100,
      purchasePrice: 120,
      discount: 0.15,
    };
    assertEqual(C.sellLot(lot, "2027-07-01", 130).qualified, false);
    assertEqual(C.sellLot(lot, "2028-01-02", 130).qualified, true);
    assertClose(C.sellLot(lot, "2028-01-02", 130).ordinary, 150);
  });
  test("delayed ESPP sales keep principal invested until the sale year", () => {
    const r = C.calculate(
      config({ salary: 100000, espp: { enabled: true, holdMonths: 25 } }),
      2026,
    );
    assertClose(r.espp.proceeds, 0);
    assert(r.stockAssets > 0);
    assert(r.espp.contributions > 0);
  });
  test("zero compensation produces finite outputs and no contributions", () => {
    const r = C.calculate(
      config({ salary: 0, retirement: { traditional: 24500, mega: 30000 } }),
      2026,
    );
    assertClose(r.contributions.totalEmployee, 0);
    assert(r.months.every((m) => Number.isFinite(m.bankCash)));
  });
  test("legacy inputs survive migration and are not silently relabeled as employer match", () => {
    const c = require("../scenario").engineInput(
      require("../scenario").migrate({
        config: {
          baseSalary: 123000,
          pretax401k: 31350,
          rsuAnnualGross: 20000,
          megaBackdoor: 24750,
          hsaContrib: 4296,
        },
      }).scenario,
    );
    assertEqual(c.salary, 123000);
    assertEqual(c.retirement.traditional, 31350);
    assertEqual(c.retirement.employerAnnual, 0);
    assertEqual(c.grants[0].value, 20000);
  });
});

describe("automatic maximum elections", () => {
  test("maximums follow remaining employer room and future limits", () => {
    const c = config({
      retirement: {
        max401k: true,
        maxMega: true,
        maxIra: true,
        iraMode: "backdoor",
        megaEnabled: true,
        employerAnnual: 10000,
      },
      hsa: { maxContribution: true, employer: 1000 },
    });
    for (const year of [2026, 2036]) {
      const r = C.calculate(c, year),
        l = C.limits(year, c.tax);
      assertClose(r.contributions.traditional, l.deferral);
      assertClose(
        r.contributions.mega +
          r.contributions.employer +
          r.contributions.traditional,
        l.total401k,
      );
      assertClose(
        r.contributions.hsa + r.contributions.hsaEmployer,
        l.hsaSingle,
      );
      assertClose(r.contributions.ira, l.ira);
    }
  });
  test("maximum elections stop when employment and compensation stop", () => {
    const r = C.calculate(
      config({
        retirement: {
          max401k: true,
          maxMega: true,
          maxIra: true,
          megaEnabled: true,
        },
        hsa: { maxContribution: true },
      }),
      2026,
      { employed: false },
    );
    assertClose(r.contributions.totalEmployee, 0);
  });
});

describe("backdoor and custom elections", () => {
  test("starting IRA assets affect conversion tax without changing IRA room", () => {
    const c = config({ retirement: { maxIra: true, iraMode: "backdoor" } });
    const clean = C.calculate(c, 2026, { iraPretaxBalance: 0 });
    const pretax = C.calculate(c, 2026, { iraPretaxBalance: 30000 });
    assertClose(pretax.income.ordinary - clean.income.ordinary, 6000);
    assertClose(pretax.contributions.ira, 7500);
  });
  test("custom elections remain available with automatic mode disabled", () => {
    const r = C.calculate(
      config({
        retirement: {
          max401k: false,
          traditional: 12000,
          maxIra: false,
          ira: 1000,
          iraMode: "backdoor",
        },
        hsa: { maxContribution: false, employee: 1000 },
      }),
      2026,
    );
    assertClose(r.contributions.traditional, 12000);
    assertClose(r.contributions.ira, 1000);
    assertClose(r.contributions.hsa, 1000);
  });
});

describe("held employee equity", () => {
  test("holding ESPP retains shares without sale income or proceeds", () => {
    const c = config({
      espp: { enabled: true, holdShares: true },
      salary: 100000,
    });
    const r = C.calculate(c, 2026);
    assertClose(r.espp.proceeds, 0);
    assertClose(r.espp.ordinary, 0);
    assert(r.stockAssets > 0);
    assert(r.espp.lots.every((l) => l.held));
  });
  test("cash inflows less all outflows reconcile while holding equity", () => {
    const r = C.calculate(
      config({ espp: { enabled: true, holdShares: true } }),
      2026,
    );
    const inflow =
      r.salary +
      r.bonus +
      r.rsuCash +
      r.income.spouse +
      r.espp.proceeds +
      r.espp.refunds;
    assertClose(
      inflow -
        r.taxes.total -
        r.benefits -
        r.contributions.totalEmployee -
        r.espp.contributions,
      r.afterTaxCash,
    );
  });
});

describe("cash flow display regressions", () => {
  test("future ESPP enrollment does not reduce current salary take-home", () => {
    const c = config({
      salary: 120000,
      tax: { state: "none" },
      frequency: "monthly",
    });
    const baseline = C.calculate(c, 2026);
    const future = C.calculate(
      C.merge(c, { espp: { enabled: true, start: "2027-01-01", rate: 0.15 } }),
      2026,
    );
    assertClose(future.regularMonthly, baseline.regularMonthly);
  });
  test("monthly bank cash exposes all incoming spouse and other cash", () => {
    const r = C.calculate(
      config({
        salary: 120000,
        tax: { filing: "married", spouseIncome: 60000 },
      }),
      2026,
      { otherIncome: 12000 },
    );
    for (const m of r.months) {
      assert(Number.isFinite(m.spouseIncome + m.otherIncome));
      assertClose(
        m.salary +
          m.bonus +
          m.rsuCash +
          m.esppProceeds +
          m.spouseIncome +
          m.otherIncome -
          m.contributions -
          m.benefits -
          m.esppContributions -
          m.withholding,
        m.bankCash,
      );
    }
  });
  test("reconciliation uses effective income and final taxes, including retirement", () => {
    const r = C.calculate(config({ salary: 0 }), 2026, {
      otherIncome: 12000,
      employed: false,
    });
    const f = C.cashFlow(r, {
      taxes: { ...r.taxes, total: 4000 },
      expenses: 36000,
      socialSecurity: 40000,
    });
    assertClose(f.cashIn, 52000);
    assertClose(f.cashOut, 40000);
    assertClose(f.netCashFlow, 12000);
    assertClose(
      f.months.reduce((n, m) => n + m.netCashFlow, 0),
      f.netCashFlow,
    );
    assertClose(
      f.months.reduce((n, m) => n + m.bankCash, 0) - f.taxBalance,
      f.afterTaxCash,
    );
  });
});

test("no salary means no salary take-home even with other taxable cash", () => {
  const r = C.calculate(config({ tax: { otherIncome: 50000 } }), 2026, {
    employed: false,
  });
  assertClose(r.regularMonthly, 0);
});
