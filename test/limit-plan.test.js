const { test, assert, assertClose, assertEqual } = require("./harness");
const Profile = require("../profile");
const Scenario = require("../scenario");
const Projection = require("../projection");

// $130,000 paid every two weeks, age 35 (2026 deferral limit $24,500).
function base() {
  const s = Scenario.defaults();
  s.taxProfile.year = 2026;
  s.taxProfile.age = 35;
  s.taxProfile.settings.state = "CA";
  s.uploads.manualFields = ["taxProfile.age"];
  Object.assign(s.compensation, {
    salary: 130000,
    frequency: "biweekly",
    firstPayday: "2026-01-09",
  });
  return s;
}
// Started contributing mid-year: $2,000 in by the Sep 4 paystub, then the
// 8 remaining biweekly checks of 2026 (Sep 18 through Dec 25).
function midYear(perCheck = 500) {
  const s = base();
  s.compensation.firstPayday = "2026-09-04";
  s.uploads.records.push({
    id: "a",
    date: "2026-09-04",
    kind: "regular",
    periodStart: "2026-08-18",
    periodEnd: "2026-08-31",
    netPay: 3000,
    current: { salary: 5000, traditional: 500, roth: 0 },
    ytd: { salary: 85000, traditional: 2000, roth: 0 },
    benefits: [],
  });
  s.uploads.elections = {
    traditional: { mode: "fixed", value: perCheck, sourceDate: "2026-09-04" },
  };
  return Scenario.normalize(s);
}
const plan = (s, key = "traditional") =>
  Profile.limitPlan(s, key, Projection.calculate(s).rows[1].payroll);
const yearTotal = (s) => {
  const c = Projection.calculate(s).rows[1].payroll.contributions;
  return c.traditional + c.roth;
};

test("a mid-year start: what's in, what's coming, and what reaches the limit", () => {
  const p = plan(midYear());
  assertEqual(p.limit, 24500);
  assertEqual(p.asOf, "2026-09-04");
  assertEqual(p.soFar, 2000);
  assertEqual(p.future, 8);
  assertEqual(p.lastDate, "2026-12-25");
  // $2,000 + 8 x $500.
  assertEqual(p.endTotal, 6000);
  assertEqual(p.reachDate, null);
  // ($24,500 - $2,000) / 8 checks.
  assertEqual(p.perCheck, 2812.5);
  // $2,812.50 of a $5,000 check.
  assertClose(p.percent, 0.5625, 1e-9);
  // One point per 2026 paycheck, cumulative.
  assertEqual(p.points.length, 26);
  assertEqual(p.points.at(-1).total, 6000);
  assertEqual(p.points.filter((x) => x.actual).length, 18);
  // Only the Sep 4 paystub is known; earlier checks are spread from its YTD.
  assertEqual(p.points.filter((x) => x.estimated).length, 17);
});

test("using the suggested amount lands exactly on the limit", () => {
  const s = midYear();
  const p = plan(s);
  Profile.setElection(s, "traditional", "check", p.perCheck);
  assertClose(yearTotal(s), 24500, 0.005);
  const after = plan(s);
  assertClose(after.endTotal, 24500, 0.005);
  assertEqual(after.reachDate, null);
});

test("a full year with no paystub spreads the limit over every check", () => {
  const s = base();
  s.uploads.elections.traditional = { mode: "fixed", value: 500 };
  const p = plan(Scenario.normalize(s));
  assertEqual(p.asOf, null);
  assertEqual(p.soFar, 0);
  assertEqual(p.future, 26);
  assertEqual(p.endTotal, 13000);
  // $24,500 / 26 = $942.307..., rounded up to the cent.
  assertEqual(p.perCheck, 942.31);
  const t = Scenario.normalize(s);
  Profile.setElection(t, "traditional", "check", p.perCheck);
  // 26 x $942.31 is $24,500.06; payroll stops at the limit.
  assertClose(yearTotal(t), 24500, 0.005);
});

test("contributing too fast reaches the limit early and stops", () => {
  const p = plan(midYear(4000));
  // $2,000 + 5 x $4,000 = $22,000 on Nov 13; the Nov 27 check tops out.
  assertEqual(p.reachDate, "2026-11-27");
  assertEqual(p.endTotal, 24500);
  assertEqual(
    p.points.filter((x) => x.date > "2026-11-27").every((x) => x.value === 0),
    true,
  );
});

test("Roth contributions share the room when solving for pre-tax", () => {
  const s = midYear();
  // Roth starts with the next check; none so far this year.
  Profile.setElection(s, "roth", "check", 100);
  const p = plan(s);
  // ($24,500 - $2,000 - 8 x $100 Roth) / 8.
  assertEqual(p.perCheck, 2712.5);
  Profile.setElection(s, "traditional", "check", p.perCheck);
  assertClose(yearTotal(s), 24500, 0.005);
});

test("no paychecks left this year means nothing to solve for", () => {
  const s = midYear();
  s.taxProfile.year = 2026;
  const payroll = Projection.calculate(s).rows[1].payroll;
  const past = {
    ...payroll,
    payrollCalendar: {
      ...payroll.payrollCalendar,
      rows: payroll.payrollCalendar.rows.filter((r) => r.date <= "2026-09-04"),
    },
  };
  const p = Profile.limitPlan(s, "traditional", past);
  assertEqual(p.future, 0);
  assertEqual(p.perCheck, null);
});

test("items without a limit plan return nothing", () => {
  const s = midYear();
  assertEqual(plan(s, "health"), null);
  assertEqual(plan(s, "espp"), null);
  assert(plan(s, "traditional"), "401(k) has a plan");
});
