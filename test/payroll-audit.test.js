const { test, assert, assertClose } = require("./harness");
const C = require("../compensation"),
  P = require("../paystub-parser"),
  S = require("../scenario"),
  Profile = require("../profile");
const record = (date, current, ytd = {}) => ({
  date,
  kind: "regular",
  current,
  ytd,
});
const config = (records) =>
  C.merge(C.defaults(), {
    salary: 156000,
    firstPayday: "2026-09-18",
    tax: { state: "none" },
    payroll: { records },
  });
test("missing newer YTD preserves prior HSA snapshot plus subsequent observed deduction", () => {
  const p = C.calculate(
    config([
      record(
        "2026-09-04",
        { salary: 6000, hsa: 100 },
        { salary: 84000, hsa: 2000 },
      ),
      record("2026-09-18", { salary: 6000, hsa: 100 }, { salary: 90000 }),
    ]),
  );
  assertClose(
    p.paychecks
      .filter((r) => r.date <= "2026-09-18")
      .reduce((n, r) => n + r.hsa, 0),
    2100,
  );
});
test("zero eligible wages cannot imply an election percentage", () => {
  const c = config([record("2026-09-18", { salary: 0, traditional: 500 })]);
  const s = P.suggest(c.payroll.records, c);
  assert(!s.elections.traditional);
  assert(s.warnings.length > 0);
});
test("employer recurring funding does not accelerate to catch up to annualized target", () => {
  const s = S.defaults();
  s.compensation.salary = 0;
  const records = [
    record(
      "2026-09-18",
      { salary: 6000, employer: 100 },
      { salary: 90000, employer: 500 },
    ),
  ];
  const updated = Profile.applyUpload(
    s,
    records,
    P.suggest(records, S.engineInput(s)),
    true,
  ).scenario;
  const p = C.calculate(S.engineInput(updated));
  assertClose(p.paychecks.find((r) => r.date > "2026-09-18").employer, 100);
});
test("Medicare uses its own YTD taxable wage counter", () => {
  const p = C.calculate(
    config([
      record(
        "2026-09-18",
        { salary: 6000, taxablePayroll: 6000, taxableMedicare: 6000 },
        { salary: 90000, taxablePayroll: 180000, taxableMedicare: 200000 },
      ),
    ]),
  );
  assertClose(p.paychecks.find((r) => r.date > "2026-09-18").medicare, 141);
});
test("ongoing salary ignores partial-year YTD while calendar forecast preserves it", () => {
  const c = config([record("2026-09-18", { salary: 6000 }, { salary: 90000 })]);
  assertClose(C.ongoing(c).salary, 156000);
  assertClose(C.calculate(c).salary, 132000);
});
test("generic benefit labels retain classifications and monthly schedules through export", () => {
  const r = P.rebuild({
    date: "2026-09-18",
    kind: "regular",
    lines: [
      {
        label: "BenefitPlus",
        section: "Post Tax Deductions",
        key: "post",
        current: 20,
        ytd: 40,
        schedule: "paycheck",
      },
      {
        label: "Transit wallet",
        section: "Pre Tax Deductions",
        key: "commuter",
        current: 120,
        ytd: 240,
        schedule: "monthly",
      },
    ],
  });
  const s = S.defaults();
  s.uploads.records = [r];
  const copy = S.normalize(JSON.parse(S.serialize(s)));
  assert(copy.uploads.records[0].benefits.length === 2);
  assert(copy.uploads.records[0].benefits[1].schedule === "monthly");
});
const parsed = (lines) =>
  P.rebuild({
    date: "2026-09-18",
    kind: "regular",
    lines: lines.map(([label, key, current, schedule = "paycheck"]) => ({
      label,
      key,
      current,
      ytd: current,
      section: key === "post" ? "Post Tax Deductions" : "Pre Tax Deductions",
      schedule,
    })),
  });
test("example one groups coverage separately from employee and employer assets", () => {
  const r = parsed([
    ["Medical", "health", 80],
    ["Dental", "health", 12],
    ["Legal plan", "post", 8],
  ]);
  Object.assign(r.current, {
    salary: 5000,
    traditional: 500,
    hsa: 100,
    hsaEmployer: 25,
    employer: 150,
  });
  const c = config([r]);
  c.salary = 130000;
  const p = C.ongoing(c);
  assertClose(p.benefits / 12, 216.6666666667, 0.001);
  assertClose(p.contributions.traditional, 13000);
  assertClose(p.contributions.hsa, 2600);
  assertClose(p.contributions.employer, 3900);
  const F = require("../compact-flow"),
    flow = C.cashFlow(p),
    g = F.build(p, flow, c),
    scene = F.layout(g, 1200);
  assertClose(g.base, 130000);
  assertClose(g.postBenefits, 208);
  assert(
    scene.links
      .filter((l) => ["pre-benefits", "post-benefits"].includes(l.b.id))
      .every((l) => l.kind === "tax"),
  );
});
test("example two monthly commuter deductions occur once even in three-paycheck months", () => {
  const r = parsed([
    ["Healthcare FSA", "fsa", 50],
    ["Transit wallet", "commuter", 120, "monthly"],
    ["Parking wallet", "parking", 80, "monthly"],
  ]);
  r.current.salary = 4000;
  const c = config([r]);
  c.salary = 104000;
  const p = C.ongoing(c);
  assertClose(p.benefits, 3700);
  for (let month = 1; month <= 12; month++) {
    const checks = p.paychecks.filter(
      (x) => Number(x.date.slice(5, 7)) === month,
    );
    assertClose(
      checks.reduce((n, x) => n + x.health, 0),
      checks.length * 50 + 200,
    );
  }
});
test("example three taxable cash, imputed earnings and one-time employer service do not become phantom cash", () => {
  const r = parsed([
    ["Lifestyle cash", "taxableAllowance", 60],
    ["Group life", "imputed", 10],
    ["Medical", "health", 100],
    ["BenefitPlus", "post", 20],
    ["Course provider payment", "employerMedical", 100, "once"],
  ]);
  r.current.salary = 6000;
  const c = config([r]),
    p = C.ongoing(c);
  assertClose(p.cashAllowance, 1560);
  assertClose(p.imputedIncome, 260);
  assertClose(p.income.wages, 157820);
  assertClose(p.benefits, 3120);
  assertClose(p.paychecks[0].grossCash, p.paychecks[0].salary + 60);
});
test("restricted benefit statutory limits cap forecasts without rewriting uploaded amounts", () => {
  const r = parsed([
    ["FSA", "fsa", 200],
    ["Transit", "commuter", 500, "monthly"],
  ]);
  r.current.salary = 6000;
  const p = C.ongoing(config([r]));
  assertClose(p.benefits, 3400 + 340 * 12);
});
test("ongoing view retains completed employer funding when the latest check is zero", () => {
  const p = C.ongoing(
    config([
      record(
        "2026-09-18",
        { salary: 6000, employer: 0 },
        { salary: 90000, employer: 1500 },
      ),
    ]),
  );
  assertClose(p.contributions.employer, 1500);
});
test("monthly benefits use that month pre-tax amounts rather than annual proportions", () => {
  const r = parsed([
    ["Transit", "commuter", 120, "monthly"],
    ["Subscription", "post", 20],
  ]);
  r.current.salary = 6000;
  const p = C.ongoing(config([r])),
    F = require("../money-flow"),
    m = F.forMonth(p, C.cashFlow(p), 1);
  assertClose(m.payroll.income.payrollDeduction, 120);
});
test("CA dependent-care exclusion stays separate from federal exclusion", () => {
  const r = parsed([["Dependent care", "dependentCare", 300]]);
  r.current.salary = 6000;
  const c = config([r]);
  c.tax.state = "CA";
  const p = C.ongoing(c);
  assertClose(p.income.stateBenefitAddback, 2500);
});
test("benefit plan cap applies after statutory cap and persists through export", () => {
  const r = parsed([["Health account", "fsa", 200]]);
  r.current.salary = 6000;
  r.benefits[0].annualCap = 2000;
  const s = S.defaults();
  s.compensation.salary = 156000;
  s.uploads.records = [r];
  const copy = S.normalize(JSON.parse(S.serialize(s)));
  assertClose(C.ongoing(S.engineInput(copy)).benefits, 2000);
});
test("later uploads reuse confirmed benefit categories and schedules by section and label", () => {
  const r = parsed([["BenefitPlus", "post", 20, "monthly"]]);
  const newer = P.parse(
    [
      {
        page: 1,
        text: "09/01/2026 09/14/2026 09/18/2026\nPost Tax Deductions\nBenefitPlus 0.00 200.00",
      },
    ],
    [r],
  );
  assert(newer.benefits[0].category === "post");
  assert(newer.benefits[0].schedule === "monthly");
  assertClose(
    P.benefitPlans([r, { ...newer, date: "2026-10-02" }])[0].current,
    20,
  );
});
test("uploaded wage YTD already includes historical equity for future Medicare thresholds", () => {
  const c = config([
    record(
      "2026-09-18",
      { salary: 6000, taxablePayroll: 6000, taxableMedicare: 6000 },
      { salary: 90000, taxablePayroll: 180000, taxableMedicare: 190000 },
    ),
  ]);
  c.grants = [
    {
      name: "Stock",
      value: 15000,
      grantPrice: 100,
      vestPrice: 100,
      start: "2025-06-01",
      months: 12,
      cliff: 12,
      interval: 12,
      saleMode: "cover",
    },
  ];
  const p = C.calculate(c);
  assertClose(p.paychecks.find((r) => r.date > "2026-09-18").medicare, 87);
});
