const { test, assert, assertClose } = require("./harness");
const S = require("../scenario"),
  P = require("../profile");
const records = [
  {
    date: "2026-09-04",
    kind: "regular",
    current: {
      salary: 6000,
      traditional: 1200,
      mega: 900,
      hsa: 150,
      hsaEmployer: 25,
      espp: 900,
      medical: 20,
    },
    ytd: { employer: 1500 },
    netPay: 1300,
  },
  {
    date: "2026-09-18",
    kind: "regular",
    current: {
      salary: 6000,
      traditional: 1200,
      mega: 900,
      hsa: 150,
      hsaEmployer: 25,
      espp: 900,
    },
    ytd: { employer: 1500 },
    netPay: 1300,
  },
];
test("profile infers biweekly calendar from actual check dates without mutating inputs", () => {
  const s = S.defaults();
  s.uploads.records = records;
  const before = JSON.stringify(s),
    p = P.describe(s);
  assert(p.schedule.frequency === "biweekly");
  assert(p.schedule.anchor === "2026-09-18");
  assertClose(p.schedule.salary, 156000);
  assert(JSON.stringify(s) === before);
});
test("one paycheck cannot establish pay frequency and YTD match is not recurring funding", () => {
  const s = S.defaults();
  s.uploads.records = [records[1]];
  const p = P.describe(s);
  assert(!p.schedule.confirmed);
  assert(p.questions.some((q) => q.id === "schedule"));
  assert(p.questions.some((q) => q.id === "employer"));
  assertClose(p.snapshot.employerRetirement, 0);
  assertClose(p.snapshot.hsa, 175);
});
test("profile questions follow observed participation rather than asking everyone", () => {
  const s = S.defaults();
  s.uploads.records = records;
  let p = P.describe(s);
  assert(p.questions.some((q) => q.id === "espp"));
  assert(p.questions.some((q) => q.id === "hsa"));
  assert(p.questions.some((q) => q.id === "mega"));
  s.uploads.records = [
    { date: "2026-09-18", current: { salary: 6000 }, netPay: 4000 },
  ];
  p = P.describe(s);
  assert(!p.questions.some((q) => ["hsa", "mega", "espp"].includes(q.id)));
});
test("uploaded employer HSA funding continues per check rather than reverting to a stale annual setting", () => {
  const C = require("../compensation");
  const p = C.calculate(
    C.merge(C.defaults(), {
      salary: 156000,
      frequency: "biweekly",
      firstPayday: "2026-09-18",
      hsa: { employee: 0, employer: 0 },
      payroll: {
        records: [
          {
            id: "hsa",
            date: "2026-09-18",
            kind: "regular",
            current: { salary: 6000, hsaEmployer: 25 },
            ytd: { salary: 90000, hsaEmployer: 375 },
          },
        ],
      },
    }),
    2026,
  );
  const future = p.paychecks.filter(
    (r) => r.source === "forecast" && r.date > "2026-09-18",
  );
  assert(future.length === 7);
  for (const r of future) assertClose(r.hsaEmployer, 25);
  assertClose(p.contributions.hsaEmployer, 550);
});
test("welcome persists for empty profiles regardless of saved tax or asset inputs", () => {
  const s = S.defaults();
  s.compensation.salary = 0;
  s.projection.startingBalances.cash = 10000;
  assert(!P.hasIncome(s));
  assert(P.initialView(s) === "welcome");
  assert(P.initialView(JSON.parse(S.serialize(s))) === "welcome");
});
test("salary, equity grants or observed earnings unlock results without optional setup", () => {
  const s = S.defaults();
  assert(P.initialView(s) === "welcome");
  s.compensation.salary = 100000;
  assert(P.initialView(s) === "monthly");
  s.compensation.salary = 0;
  s.uploads.records = [{ current: { salary: 5000 } }];
  assert(P.hasIncome(s));
  s.uploads.records = [{ current: { traditional: 100 } }];
  assert(!P.hasIncome(s));
  s.compensation.grants = [{ value: 12000 }];
  assert(P.hasIncome(s));
});
test("upload fills participation, salary, ESPP and recurring elections with sources", () => {
  const s = S.defaults();
  s.compensation.salary = 0;
  const suggestion = {
    record: records[1],
    salary: 156000,
    frequency: "biweekly",
    firstPayday: "2026-09-18",
    elections: {
      espp: { mode: "percent", value: 0.15, sourceDate: "2026-09-18" },
      traditional: { mode: "percent", value: 0.2, sourceDate: "2026-09-18" },
      hsa: { mode: "fixed", value: 150, sourceDate: "2026-09-18" },
    },
  };
  const result = P.applyUpload(s, records, suggestion, true);
  assert(result.scenario.employerPlan.espp.enabled);
  assertClose(result.scenario.employerPlan.espp.rate, 0.15);
  assertClose(result.scenario.compensation.salary, 156000);
  assert(
    result.scenario.uploads.fieldSources["employerPlan.espp.rate"]
      .sourceDate === "2026-09-18",
  );
  assert(!s.employerPlan.espp.enabled);
  const roundtrip = S.normalize(JSON.parse(S.serialize(result.scenario)));
  assert(
    roundtrip.uploads.fieldSources["employerPlan.espp.rate"].sourceDate ===
      "2026-09-18",
  );
});
test("manual overrides survive newer uploads and conflicts are reported", () => {
  const s = S.defaults();
  s.compensation.salary = 0;
  let result = P.applyUpload(
    s,
    records,
    {
      record: records[1],
      elections: {
        espp: { mode: "percent", value: 0.15, sourceDate: "2026-09-18" },
      },
    },
    false,
  );
  P.edit(result.scenario, "employerPlan.espp.rate", 0.1);
  const updated = P.applyUpload(
    result.scenario,
    records,
    {
      record: records[1],
      elections: {
        espp: { mode: "percent", value: 0.18, sourceDate: "2026-10-02" },
      },
    },
    false,
  );
  assertClose(updated.scenario.employerPlan.espp.rate, 0.1);
  assertClose(updated.scenario.uploads.elections.espp.value, 0.1);
  assert(updated.scenario.uploads.elections.espp.manual);
  assert(updated.conflicts.length > 0);
  assert(S.normalize(updated.scenario).uploads.elections.espp.manual);
});
test("upload preserves preexisting nondefault plan terms and does not invent recurring employer match", () => {
  const s = S.defaults();
  s.employerPlan.espp.rate = 0.08;
  s.employerPlan.espp.discount = 0.1;
  const r = P.applyUpload(
    s,
    records,
    {
      record: records[1],
      elections: {
        espp: { mode: "percent", value: 0.15, sourceDate: "2026-09-18" },
      },
    },
    false,
  );
  assertClose(r.scenario.employerPlan.espp.rate, 0.08);
  assertClose(r.scenario.employerPlan.espp.discount, 0.1);
  assertClose(r.scenario.employerPlan.retirement.employerAnnual, 0);
});
test("editing the shared ESPP election keeps the plan field aligned on a later upload", () => {
  const s = S.defaults();
  s.compensation.salary = 0;
  const suggestion = {
    record: records[1],
    elections: {
      espp: { mode: "percent", value: 0.15, sourceDate: "2026-09-18" },
    },
  };
  const r = P.applyUpload(s, records, suggestion, false);
  P.edit(r.scenario, "uploads.elections.espp.value", 0.07);
  const next = P.applyUpload(r.scenario, records, suggestion, false).scenario;
  assertClose(next.employerPlan.espp.rate, 0.07);
  assertClose(next.uploads.elections.espp.value, 0.07);
});
test("manual contribution and salary overrides control future checks after newer observations", () => {
  const C = require("../compensation");
  const s = S.defaults();
  s.compensation.salary = 156000;
  s.compensation.firstPayday = "2026-09-18";
  s.uploads.records = [
    {
      date: "2026-09-18",
      kind: "regular",
      current: { salary: 6000, traditional: 1200 },
    },
  ];
  s.uploads.elections = {
    traditional: {
      mode: "percent",
      value: 0.1,
      sourceDate: "2026-09-04",
      manual: true,
    },
  };
  s.uploads.manualFields = ["compensation.salary"];
  const p = C.calculate(S.engineInput(s), 2026);
  const next = p.paychecks.find(
    (r) => r.source === "forecast" && r.date > "2026-09-18",
  );
  assertClose(next.traditional, 600);
});
test("employer funding summary separates recorded YTD from future forecast", () => {
  const s = S.defaults();
  s.uploads.records = [
    { date: "2026-09-18", current: { salary: 6000 }, ytd: { employer: 1500 } },
  ];
  const p = {
    paychecks: [
      { date: "2026-09-18", source: "uploaded", employer: 0 },
      { date: "2026-10-02", source: "forecast", employer: 200 },
    ],
    contributions: { employer: 1700 },
  };
  const f = P.employerFunding(s, p);
  assertClose(f.ytd, 1500);
  assertClose(f.remaining, 200);
  assertClose(f.total, 1700);
});
test("grant preview distinguishes years, cliff value and market value", () => {
  const g = P.grantPreview({
    value: 95000,
    months: 36,
    cliff: 6,
    interval: 1,
    start: "2026-03-16",
    grantPrice: 19.25,
    vestPrice: 17,
  });
  assertClose(g.years, 3);
  assertClose(g.grantValue, 95000 / 6);
  assertClose(g.marketValue, (95000 / 6 / 19.25) * 17);
  assert(g.date === "2026-09-16");
});
test("field status distinguishes unresolved inputs, uploaded values and manual choices", () => {
  const s = S.defaults();
  s.compensation.salary = 0;
  assert(P.fieldState(s, "compensation.salary").label === "Needs input");
  s.uploads.fieldSources = {
    "compensation.salary": { sourceDate: "2026-09-18" },
  };
  assert(P.fieldState(s, "compensation.salary").kind === "observed");
  P.edit(s, "compensation.salary", 165000);
  assert(P.fieldState(s, "compensation.salary").kind === "manual");
  assert(P.fieldState(s, "projection.marketReturn").kind === "optional");
});
test("a cliff before the recurring vest interval still vests on the cliff date", () => {
  const g = P.grantPreview({
    value: 95000,
    months: 36,
    cliff: 6,
    interval: 12,
    start: "2026-03-16",
    grantPrice: 19.25,
    vestPrice: 19.25,
  });
  assert(g.date === "2026-09-16");
  assertClose(g.grantValue, 95000 / 6);
});
test("confirming an assumption persists without turning it into a payroll override", () => {
  const s = S.defaults();
  assert(P.fieldState(s, "employerPlan.hsa.coverage").kind === "review");
  P.confirm(s, "employerPlan.hsa.coverage");
  assert(P.fieldState(s, "employerPlan.hsa.coverage").kind === "confirmed");
  assert(!(s.uploads.manualFields || []).includes("employerPlan.hsa.coverage"));
  const copy = S.normalize(JSON.parse(S.serialize(s)));
  assert(P.fieldState(copy, "employerPlan.hsa.coverage").kind === "confirmed");
  copy.employerPlan.hsa.coverage = "family";
  assert(P.fieldState(copy, "employerPlan.hsa.coverage").kind === "review");
});
test("display precision preserves original cents and contribution rates", () => {
  assert(P.displayValue(1234.567, "number") === "1234.57");
  assert(P.displayValue(0.19456, "percent") === "19.5");
  assert(P.displayValue(36, "years") === 3);
});
