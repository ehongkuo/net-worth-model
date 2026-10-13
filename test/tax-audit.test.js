const { test, assert, assertClose } = require("./harness");
const C = require("../compensation");
const F = require("../money-flow");
const sum = (rows, key) => rows.reduce((s, r) => s + r[key], 0);
const cfg = (patch) =>
  C.merge(C.defaults(), { salary: 120000, tax: { state: "none" }, ...patch });
test("tax audit: each federal bracket reconciles to independently calculated tax", () => {
  const t = C.tax({ wages: 120000, pretax: 24000 }, 2026, { state: "none" });
  assertClose(t.federal, 12290, 0.001);
  assertClose(t.audit.federalAgi, 96000, 0.001);
  assertClose(sum(t.audit.federalBrackets, "income"), 79900, 0.001);
  assertClose(sum(t.audit.federalBrackets, "tax"), 12290, 0.001);
  assertClose(t.audit.federalBrackets[2].income, 29500, 0.001);
});
test("tax audit: traditional saves income tax, Roth and mega do not reduce FICA or taxable income", () => {
  const trad = C.calculate(cfg({ retirement: { traditional: 24000 } }));
  const roth = C.calculate(
    cfg({ retirement: { roth: 24000, megaEnabled: true, mega: 10000 } }),
  );
  assertClose(roth.taxes.federal - trad.taxes.federal, 5280, 0.001);
  assertClose(trad.taxes.fica, 9180, 0.001);
  assertClose(roth.taxes.fica, 9180, 0.001);
  assertClose(roth.taxes.audit.federalAgi, 120000, 0.001);
});
test("tax audit: capital gains stack above ordinary taxable income", () => {
  const t = C.tax({ wages: 100000, longGain: 20000 }, 2026, { state: "none" });
  assertClose(t.federal, 16170, 0.001);
  assertClose(sum(t.audit.capitalBrackets, "income"), 20000, 0.001);
  assertClose(sum(t.audit.capitalBrackets, "tax"), 3000, 0.001);
});
test("tax audit: nonrefundable income tax credits cannot erase NIIT", () => {
  const t = C.tax({ wages: 300000, longGain: 10000 }, 2026, {
    state: "none",
    federalCredits: 1000000,
  });
  assertClose(t.niit, 380, 0.001);
  assertClose(t.federal, 380, 0.001);
});
test("tax audit: taxable ESPP sales create income once, after-tax principal never becomes taxable", () => {
  const espp = {
    enabled: true,
    rate: 0.1,
    holdShares: false,
    holdMonths: 0,
    fractional: true,
    shareCap: 0,
    offerPrice: 100,
    purchasePrice: 100,
    salePrice: 100,
  };
  const p = C.calculate(cfg({ espp }));
  assertClose(p.espp.ordinary, ((26 * 461.54) / 85) * 15, 0.001);
  assertClose(
    p.taxes.federal - 17570,
    1800 * 0.22 + (((26 * 461.54) / 85) * 15 - 1800) * 0.24,
    0.001,
  );
  assertClose(
    p.taxFunding.esppSaleTax,
    1800 * 0.22 + (((26 * 461.54) / 85) * 15 - 1800) * 0.24,
    0.001,
  );
});
test("tax audit: a held ESPP reserve is cash earmarked, not current tax or lost net worth", () => {
  const espp = {
    enabled: true,
    rate: 0.1,
    holdShares: true,
    fractional: true,
    shareCap: 0,
    offerPrice: 100,
    purchasePrice: 100,
    salePrice: 100,
    reserveFutureTax: true,
    reserveSaleMonths: 0,
  };
  const p = C.calculate(cfg({ espp })),
    f = C.cashFlow(p),
    g = F.buildFlow(p, f);
  assertClose(p.taxes.federal, 17570, 0.001);
  assertClose(
    f.futureTaxReserve,
    1800 * 0.22 + (((26 * 461.54) / 85) * 15 - 1800) * 0.24,
    0.001,
  );
  assertClose(f.spendableCashFlow + f.futureTaxReserve, f.netCashFlow, 0.001);
  assert(g.nodes.find((n) => n.id === "future-tax-reserve")?.kind === "asset");
});
test("tax audit: RSU gross splits into cover and equity and never duplicates cash taxes", () => {
  const p = C.calculate(
      cfg({
        grants: [
          {
            value: 12000,
            start: "2025-12-31",
            months: 12,
            interval: 3,
            grantPrice: 100,
            vestPrice: 100,
            saleMode: "cover",
          },
        ],
      }),
    ),
    f = C.cashFlow(p),
    g = F.buildFlow(p, f);
  const out = g.links.filter((l) => l.source === "rsu-vesting");
  assertClose(sum(out, "value"), 12000, 0.001);
  assertClose(p.rsuSellToCover, 3558, 0.001);
  assertClose(
    p.taxFunding.cashWithholding + p.taxFunding.rsuWithholding,
    p.withholding,
    0.001,
  );
  assertClose(
    f.taxFunding.remainingLiability + p.withholding,
    p.taxes.total,
    0.001,
  );
});
test("tax audit: annual estimated payments reduce remaining liability, not total taxes", () => {
  const p = C.calculate(
      cfg({ tax: { state: "none", estimatedPayments: 2000 } }),
    ),
    f = C.cashFlow(p),
    g = F.buildFlow(p, f);
  assertClose(
    f.taxFunding.remainingLiability,
    p.taxes.total - p.withholding - 2000,
    0.001,
  );
  assertClose(f.netCashFlow, 120000 - 17570 - 9180, 0.001);
  for (const n of g.nodes.filter((n) => n.kind === "hub"))
    assertClose(
      sum(
        g.links.filter((l) => l.target === n.id),
        "value",
      ),
      sum(
        g.links.filter((l) => l.source === n.id),
        "value",
      ),
      0.001,
    );
});
test("tax audit: federal W-4 method uses ordinary payroll withholding, not AMT or NIIT", () => {
  const p = C.calculate(
    cfg({
      tax: {
        state: "none",
        withholdingMethod: "w4",
        w4Credits: 2000,
        w4OtherIncome: 10000,
        w4Deductions: 5000,
      },
    }),
  );
  // 125,000 - 16,100 = 108,900; 17,966 + 3,200*24% - 2,000.
  assertClose(sum(p.months, "federal"), 16733.98, 0.001);
});
test("tax audit: direct HSA deductions require a W-4 adjustment to affect paycheck withholding", () => {
  const p = C.calculate(
    cfg({
      hsa: { employee: 4000, payroll: false },
      tax: { state: "none", withholdingMethod: "w4" },
    }),
  );
  assertClose(sum(p.months, "federal"), 17570.02, 0.001);
  assertClose(p.taxes.federal, 16690, 0.001);
});
test("tax audit: ESPP tax impact uses the final projection tax context", () => {
  const p = C.calculate(
    cfg({
      espp: {
        enabled: true,
        rate: 0.1,
        holdShares: false,
        fractional: true,
        shareCap: 0,
        offerPrice: 100,
        purchasePrice: 100,
        salePrice: 100,
      },
    }),
  );
  const final = C.tax(
      { ...p.income, ordinary: p.income.ordinary + 50000 },
      2026,
      { state: "none" },
    ),
    f = C.cashFlow(p, { taxes: final });
  assertClose(
    f.taxFunding.esppSaleTax,
    ((26 * 461.54) / 85) * 15 * 0.24,
    0.001,
  );
});
test("tax audit: source allocation conserves every bracket and avoids negative slices", () => {
  const T = require("../tax-engine"),
    rows = T.bracketRows(
      79900,
      [12400, 50400, 105700],
      [0.1, 0.12, 0.22, 0.24],
    );
  const result = T.allocateSources(
    [
      { label: "Salary", value: 120000 },
      { label: "Bonus", value: 12000 },
    ],
    rows,
  );
  for (const r of result) {
    assertClose(sum(r.sources, "value"), r.income, 0.001);
    assert(r.sources.every((s) => s.value >= 0));
  }
});
test("tax audit: W-4 household withholding includes an estimate for the spouse paycheck", () => {
  const p = C.calculate(
    cfg({
      tax: {
        state: "none",
        filing: "married",
        spouseIncome: 60000,
        withholdingMethod: "w4",
      },
    }),
  );
  // Cent rounding applies to each of the 26 primary checks.
  // Two MFJ W-4s, no multiple-jobs checkbox or credits: 10,040 + 2,840.
  assertClose(sum(p.months, "federal"), 12879.9, 0.001);
});
test("tax audit: California schedule reconciles at its published baseline", () => {
  const t = C.tax({ wages: 120000, pretax: 24000 }, 2026, {
    state: "CA",
    caGrowth2026: 0,
  });
  assertClose(t.state, 4682.98, 0.001);
  assertClose(
    sum(t.audit.stateBrackets, "tax") + t.audit.stateNetAdjustments,
    t.state,
    0.001,
  );
});
test("tax audit: estimated payments and future earmarks reconcile all monthly cash", () => {
  const p = C.calculate(
      cfg({
        tax: { state: "none", estimatedPayments: 2000 },
        espp: {
          enabled: true,
          rate: 0.1,
          holdShares: true,
          fractional: true,
          shareCap: 0,
          reserveFutureTax: true,
          reserveSaleMonths: 0,
        },
      }),
    ),
    f = C.cashFlow(p),
    g = F.buildFlow(p, f);
  assertClose(sum(f.months, "netCashFlow"), f.netCashFlow, 0.001);
  assertClose(sum(f.months, "spendableCashFlow"), f.spendableCashFlow, 0.001);
  assertClose(
    g.summary.remainingCash - g.summary.fundingNeeded,
    f.spendableCashFlow,
    0.001,
  );
});
test("tax audit: federal explanation reconciles even when a negative adjustment is capped at zero", () => {
  const t = C.tax({ wages: 120000 }, 2026, {
    state: "none",
    federalAdjustment: -100000,
  });
  assertClose(
    t.audit.regular +
      t.amt -
      t.audit.federalCreditsApplied +
      t.niit +
      t.audit.federalAdjustment,
    t.federal,
    0.001,
  );
});
