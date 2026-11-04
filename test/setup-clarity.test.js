const {
  describe,
  test,
  assert,
  assertClose,
  assertEqual,
} = require("./harness");
const P = require("../paystub-parser"),
  S = require("../scenario"),
  Profile = require("../profile"),
  Projection = require("../projection"),
  CompactFlow = require("../compact-flow"),
  Presentation = require("../presentation");

// A synthetic $78,000 biweekly paycheck, with or without an HSA line.
const header = `Pay Period Begin Pay Period End Check Date
10/11/2026 10/24/2026 10/30/2026
Current and YTD Totals`;
const paycheck = (hsa) =>
  P.parse([
    {
      page: 1,
      text: `${header}
Current 0.00 3,000.00 ${hsa ? "100.00" : "0.00"} 500.00 0.00 ${hsa ? "2,400.00" : "2,500.00"}
YTD 0.00 66,000.00 ${hsa ? "2,200.00" : "0.00"} 11,000.00 0.00 ${hsa ? "52,800.00" : "55,000.00"}
Earnings
Regular Salary 3,000.00 66,000.00
${hsa ? "Pre Tax Deductions\nHSA 100.00 2,200.00\n" : ""}Employee Taxes
Federal Withholding 500.00 11,000.00`,
    },
  ]);
const upload = (s, records) =>
  Profile.applyUpload(s, records, P.suggest(records, S.engineInput(s)), true)
    .scenario;

describe("HSA eligibility from paystubs", () => {
  test("no HSA line on any paystub turns eligibility off, as a guess", () => {
    const s = upload(S.defaults(), [paycheck(false)]);
    assertEqual(s.employerPlan.hsa.eligible, false);
    assertEqual(
      Profile.fieldState(s, "employerPlan.hsa.eligible").kind,
      "inferred",
    );
  });
  test("an HSA line keeps it on", () => {
    const s = upload(S.defaults(), [paycheck(true)]);
    assertEqual(s.employerPlan.hsa.eligible, true);
  });
  test("eligibility the user set is kept", () => {
    const s = S.defaults();
    Profile.edit(s, "employerPlan.hsa.eligible", true);
    assertEqual(upload(s, [paycheck(false)]).employerPlan.hsa.eligible, true);
  });
  test("an RSU vest alone says nothing about the HSA", () => {
    const vest = { ...paycheck(false), kind: "equity" };
    assertEqual(upload(S.defaults(), [vest]).employerPlan.hsa.eligible, true);
  });
});

function flow(extra) {
  const s = S.defaults();
  s.compensation.salary = 150000;
  s.taxProfile.settings.state = "none";
  extra(s);
  const n = S.normalize(s),
    r = Projection.calculate(n);
  return CompactFlow.build(r.ongoing.payroll, r.ongoing.flow, S.engineInput(n));
}

describe("other cash is named", () => {
  test("spouse wages are their own part", () => {
    const g = flow((s) => {
      s.taxProfile.settings.filing = "married";
      s.taxProfile.settings.spouseIncome = 90000;
    });
    assertEqual(g.otherParts.length, 1);
    assertEqual(g.otherParts[0].label, "Spouse pay");
    assertClose(g.otherParts[0].value, 90000, 0.01);
    assertEqual(g.otherLabel, "Spouse pay");
    const pay = Presentation.compensation(g).sources.find(
      (x) => x.id === "pay",
    );
    assert(
      pay.items.some(
        (i) => i.label === "Spouse pay" && Math.abs(i.value - 90000) < 0.01,
      ),
    );
  });
  test("other ordinary income is its own part", () => {
    const g = flow((s) => (s.taxProfile.settings.otherIncome = 12000));
    assertClose(
      g.otherParts.find((x) => x.label === "Other income").value,
      12000,
      0.01,
    );
  });
  test("rounding leftovers under $1 are not shown", () => {
    const g = flow(() => {});
    assert(Math.abs(g.otherCash) < 1);
    assertEqual(g.otherShown, 0);
    assertEqual(g.otherParts.length, 0);
  });
});

describe("plain notes", () => {
  test("the spouse wage note says what is and isn't modeled", () => {
    const g = flow((s) => {
      s.taxProfile.settings.filing = "married";
      s.taxProfile.settings.spouseIncome = 90000;
    });
    const note = g.payroll.warnings.find((w) => /spouse/i.test(w));
    assert(!/withholding overrides|reconcile/i.test(note), note);
    assert(/withh/i.test(note) && /tax due/i.test(note), note);
  });
});

describe("profile Edit links name their field", () => {
  const paths = (s) =>
    Object.fromEntries(Presentation.facts(s).map((f) => [f.id, f.paths]));
  test("each fact points at the input that changes it", () => {
    const p = paths(S.defaults());
    assertEqual(p.salary[0], "compensation.salary");
    assertEqual(p.schedule[0], "compensation.frequency");
    assertEqual(p.espp.at(-1), "employerPlan.espp.enabled");
  });
  test("a missing state points at the state, a set one at filing", () => {
    const s = S.defaults();
    s.taxProfile.settings.state = "";
    assertEqual(paths(s).tax[0], "taxProfile.settings.state");
    s.taxProfile.settings.state = "CA";
    assertEqual(paths(s).tax[0], "taxProfile.settings.filing");
  });
});
