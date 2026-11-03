const { test, assert, assertClose, assertEqual } = require("./harness");
const UI = require("../presentation");
const Scenario = require("../scenario"),
  Projection = require("../projection"),
  CompactFlow = require("../compact-flow");

const by = (rows, id) => rows.find((r) => r.id === id);
const total = (rows) => rows.reduce((s, r) => s + r.value, 0);

// A hand-built flow graph. Cash before deductions is
// 120,000 + 12,000 + 1,200 + 300 = 133,500, and cash left after deductions is
// 133,500 - 600 - 5,000 - 30,000 - 20,000 - 2,400 = 75,500.
const graph = {
  payroll: {
    salary: 120000,
    bonus: 12000,
    cashAllowance: 1200,
    contributions: { employer: 6000, hsaEmployer: 1000 },
  },
  otherCash: 300,
  cashBeforeDeductions: 133500,
  rsuGross: 24000,
  rsuCover: 9000,
  rsuRetained: 15000,
  rsuCash: 0,
  employer: 7000,
  esppCost: 5000,
  esppValue: 6000,
  cashTax: 30000,
  pretaxRetirement: 20000,
  postRetirement: 0,
  benefits: 2400,
  postBenefits: 600,
  cashFinal: 75500,
  buckets: [
    {
      id: "cash",
      value: 75500,
      parts: [
        { label: "Spendable cash", value: 74000 },
        { label: "Future-tax cash reserve", value: 1500 },
      ],
    },
    {
      id: "equity",
      value: 21000,
      parts: [
        { label: "Retained RSUs", value: 15000 },
        { label: "ESPP shares", value: 6000 },
      ],
    },
    {
      id: "retirement",
      value: 27000,
      parts: [
        { label: "Traditional 401(k)", value: 18000 },
        { label: "Employer retirement", value: 6000 },
        { label: "HSA (employee + employer)", value: 3000 },
      ],
    },
  ],
};

test("compensation splits into cash pay, equity and employer money", () => {
  const c = UI.compensation(graph);
  assertEqual(by(c.sources, "pay").value, 133500);
  assertEqual(by(c.sources, "equity").value, 25000);
  assertEqual(by(c.sources, "employer").value, 7000);
  assertEqual(c.total, 165500);
  assertEqual(
    by(c.sources, "pay")
      .items.map((i) => i.value)
      .join(","),
    "120000,12000,1200,300",
  );
  // The ESPP discount on held shares is compensation; their cost is pay.
  assertEqual(
    by(c.sources, "equity")
      .items.map((i) => i.value)
      .join(","),
    "24000,1000",
  );
  assertEqual(
    by(c.sources, "employer")
      .items.map((i) => i.value)
      .join(","),
    "6000,1000",
  );
});

test("every dollar of compensation lands in exactly one place", () => {
  const c = UI.compensation(graph);
  assertEqual(by(c.uses, "tax").value, 39000);
  assertEqual(by(c.uses, "retirement").value, 27000);
  assertEqual(by(c.uses, "benefits").value, 3000);
  assertEqual(by(c.uses, "kept").value, 21000);
  assertEqual(by(c.uses, "cash").value, 75500);
  assertEqual(total(c.uses), c.total);
  assertEqual(total(c.sources), c.total);
  // Group totals equal their line items.
  for (const g of [...c.sources, ...c.uses])
    assertClose(total(g.items), g.value, 0.005, g.id);
});

test("an employer total below the plan amounts is capped in its items", () => {
  const c = UI.compensation({ ...graph, employer: 5000 });
  const employer = by(c.sources, "employer");
  assertEqual(employer.value, 5000);
  assertEqual(employer.items.map((i) => i.value).join(","), "5000");
});

function project(setup) {
  const s = Scenario.defaults();
  s.taxProfile.settings.state = "CA";
  setup(s);
  const { payroll, flow } = Projection.calculate(s).ongoing;
  return {
    payroll,
    c: UI.compensation(
      CompactFlow.build(payroll, flow, Scenario.engineInput(s)),
    ),
  };
}

test("projected compensation reconciles for materially different users", () => {
  const cases = {
    "salary only": (s) => (s.compensation.salary = 90000),
    "full package": (s) => {
      Object.assign(s.compensation, {
        salary: 200000,
        bonusPercent: 0.1,
        grants: [
          {
            name: "Grant",
            value: 160000,
            start: "2025-05-15",
            cliff: 0,
            interval: 3,
            years: 4,
            saleMode: "cover",
            grantPrice: 100,
            vestPrice: 100,
          },
        ],
      });
      Object.assign(s.employerPlan.retirement, {
        traditional: 20000,
        matchPercent: 0.05,
        matchRate: 0.5,
      });
      Object.assign(s.employerPlan.hsa, { employee: 3000, employer: 1000 });
      Object.assign(s.employerPlan.benefits, { health: 100, dental: 10 });
      Object.assign(s.employerPlan.espp, {
        enabled: true,
        rate: 0.1,
        holdShares: true,
      });
    },
    "no income": () => {},
  };
  for (const [name, setup] of Object.entries(cases)) {
    const { payroll, c } = project(setup);
    assertClose(total(c.sources), c.total, 0.01, name);
    assertClose(total(c.uses), c.total, 0.01, name);
    assertClose(
      by(c.sources, "pay").items.find((i) => i.label === "Base salary")
        ?.value || 0,
      payroll.salary,
      0.01,
      name,
    );
  }
  const { c } = project(cases["full package"]);
  // 5% of $220,000 (salary plus the match-eligible 10% bonus) matched at
  // 50%, plus the $1,000 employer HSA deposit.
  assertClose(by(c.sources, "employer").value, 6500, 0.01);
  assertClose(by(c.sources, "equity").items[0].value, 40000, 0.01);
  assert(by(c.uses, "tax").value > 0);
});

test("the profile facts describe the user's inputs, with gaps marked", () => {
  const s = Scenario.defaults();
  Object.assign(s.compensation, {
    salary: 150000,
    frequency: "biweekly",
    grants: [{ name: "A", value: 1000 }],
  });
  s.taxProfile.settings.state = "CA";
  s.employerPlan.retirement.traditional = 10000;
  s.employerPlan.retirement.roth = 2000;
  Object.assign(s.employerPlan.espp, { enabled: true, rate: 0.1 });
  const facts = UI.facts(s);
  const value = (id) => by(facts, id).value;
  assertEqual(value("salary"), "$150,000 a year");
  assertEqual(value("schedule"), "Every two weeks");
  assertEqual(value("tax"), "Single · CA");
  assertEqual(value("retirement"), "$10,000 pre-tax · $2,000 Roth");
  assertEqual(value("espp"), "10% of pay");
  assertEqual(value("grants"), "1 grant");
  assert(facts.every((f) => f.step >= 0 && f.step <= 2));

  const blank = UI.facts(Scenario.defaults());
  assert(by(blank, "salary").missing);
  assert(by(blank, "tax").missing, "no state yet");
  assertEqual(by(blank, "retirement").value, "Not contributing");
  assertEqual(by(blank, "espp").value, "Not enrolled");
  assertEqual(by(blank, "grants").value, "None");
});

test("a paycheck steps from gross pay down to the deposit", () => {
  const p = UI.paycheck({
    current: {
      salary: 5000,
      federal: 800,
      state: 300,
      ss: 310,
      medicare: 72.5,
      traditional: 500,
      hsa: 100,
      health: 50,
      espp: 500,
      employer: 250,
      hsaEmployer: 20,
    },
  });
  assertEqual(p.gross, 5000);
  assertEqual(
    p.steps.map((s) => `${s.id}:${s.value}`).join(","),
    "tax:1482.5,retirement:600,benefits:50,espp:500",
  );
  // 5,000 - 1,482.50 - 600 - 50 - 500
  assertEqual(p.deposit, 2367.5);
  assertEqual(p.employer, 270);
  const empty = UI.paycheck({ current: {} });
  assertEqual(empty.gross, 0);
  assertEqual(empty.steps.length, 0);
  assertEqual(empty.deposit, 0);
});

test("profile facts show what the projection models, including paystub elections", () => {
  const s = Scenario.defaults();
  s.compensation.salary = 0;
  s.taxProfile.settings.state = "NY";
  s.employerPlan.espp.enabled = true;
  s.employerPlan.espp.rate = 0.05;
  // Elections read from a paystub; the annual plan settings stay at zero.
  s.uploads.elections = {
    traditional: { mode: "percent", value: 0.08, sourceDate: "2026-09-18" },
    espp: { mode: "percent", value: 0.12, sourceDate: "2026-09-18" },
  };
  const payroll = {
    salary: 130000,
    contributions: {
      traditional: 10400,
      roth: 0,
      mega: 0,
      hsa: 2600,
      hsaEmployer: 520,
    },
  };
  const facts = UI.facts(s, payroll);
  const fact = (id) => by(facts, id);
  assertEqual(fact("salary").value, "$130,000 a year");
  assert(!fact("salary").missing);
  assertEqual(fact("retirement").value, "$10,400 pre-tax");
  assertEqual(fact("retirement").source, "From your paystubs");
  // Employee $2,600 plus employer $520.
  assertEqual(fact("hsa").value, "$3,120 a year");
  assertEqual(fact("espp").value, "12% of pay");
  assertEqual(fact("espp").source, "From your paystubs");
  assertEqual(fact("tax").value, "Single · NY");
});
