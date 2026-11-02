const { test, assert, assertClose, assertEqual } = require("./harness");
const Profile = require("../profile");
const Scenario = require("../scenario");

// 2026 IRS figures: $24,500 deferrals, $8,000 catch-up at 50+, $11,250 at
// 60-63, $72,000 total 401(k), HSA $4,400 self-only / $8,750 family plus
// $1,000 at 55+, and $25,000 of ESPP stock a year.
function scenario({ age, ageKnown = true } = {}) {
  const s = Scenario.defaults();
  s.taxProfile.year = 2026;
  Object.assign(s.compensation, { salary: 130000, frequency: "biweekly" });
  if (age != null) s.taxProfile.age = age;
  if (ageKnown) s.uploads.manualFields = ["taxProfile.age"];
  return s;
}
const fixed = (value) => ({ mode: "fixed", value });

test("pre-tax and Roth 401(k) share one limit", () => {
  const s = scenario({ age: 35 });
  s.uploads.elections.traditional = fixed(500);
  s.uploads.elections.roth = fixed(100);
  const c = Profile.limitCheck(s, "traditional");
  assertEqual(c.limit, 24500);
  assertEqual(c.global, 24500);
  // ($500 + $100) x 26 checks.
  assertEqual(c.used, 15600);
  assert(!c.over);
  assertEqual(c.remaining, 8900);
  assertEqual(Profile.limitCheck(s, "roth").used, 15600);
});

test("catch-up contributions raise the limit by age", () => {
  const limit = (age) => {
    const s = scenario({ age });
    s.uploads.elections.traditional = fixed(500);
    return Profile.limitCheck(s, "traditional").limit;
  };
  assertEqual(limit(49), 24500);
  assertEqual(limit(50), 32500);
  assertEqual(limit(60), 35750);
  assertEqual(limit(63), 35750);
  assertEqual(limit(64), 32500);
});

test("an unknown age uses the base limit and asks for it", () => {
  const s = scenario({ age: 55, ageKnown: false });
  s.uploads.elections.traditional = fixed(500);
  const c = Profile.limitCheck(s, "traditional");
  assertEqual(c.limit, 24500);
  assert(
    c.notes.some((n) => /age/i.test(n)),
    "a note asks for the user's age",
  );
});

test("going over the limit is flagged with the amount over", () => {
  const s = scenario({ age: 35 });
  s.uploads.elections.traditional = fixed(1000);
  const c = Profile.limitCheck(s, "traditional");
  assertEqual(c.used, 26000);
  assert(c.over);
  assertEqual(c.remaining, -1500);
});

test("deferrals at a previous employer this year count toward the limit", () => {
  const s = scenario({ age: 35 });
  s.uploads.elections.traditional = fixed(500);
  s.employerPlan.retirement.priorDeferrals = 5000;
  const c = Profile.limitCheck(s, "traditional");
  assertEqual(c.used, 18000);
  assertEqual(c.remaining, 6500);
});

test("the HSA limit depends on coverage, age, months and employer money", () => {
  const hsa = (setup, employer = 1000) => {
    const s = scenario({ age: 40 });
    s.uploads.elections.hsa = fixed(100);
    Object.assign(s.employerPlan.hsa, { eligible: true, eligibleMonths: 12 });
    setup(s);
    return Profile.limitCheck(s, "hsa", { hsaEmployer: employer });
  };
  // $4,400 self-only minus the employer's $1,000.
  const single = hsa(() => {});
  assertEqual(single.global, 4400);
  assertEqual(single.limit, 3400);
  assertEqual(single.used, 2600);
  assertEqual(hsa((s) => (s.employerPlan.hsa.coverage = "family")).limit, 7750);
  assertEqual(hsa((s) => (s.taxProfile.age = 56)).limit, 4400);
  // Six eligible months: half of $4,400, less the employer's $1,000.
  assertEqual(hsa((s) => (s.employerPlan.hsa.eligibleMonths = 6)).limit, 1200);
  assertEqual(hsa((s) => (s.employerPlan.hsa.eligible = false)).limit, 0);
  assertEqual(hsa(() => {}, 0).limit, 4400);
});

test("after-tax 401(k) room is what's left of the total plan limit", () => {
  const s = scenario({ age: 35 });
  s.uploads.elections.traditional = fixed(500);
  s.uploads.elections.mega = fixed(1000);
  // $72,000 - $13,000 deferred - $6,500 from the employer.
  const c = Profile.limitCheck(s, "mega", { employer: 6500 });
  assertEqual(c.global, 72000);
  assertEqual(c.limit, 52500);
  assertEqual(c.used, 26000);
  s.employerPlan.retirement.megaAnnualCap = 20000;
  const capped = Profile.limitCheck(s, "mega", { employer: 6500 });
  assertEqual(capped.limit, 20000);
  assert(capped.over);
});

test("ESPP contributions are checked against $25,000 of stock at a discount", () => {
  const s = scenario({ age: 35 });
  s.uploads.elections.espp = { mode: "percent", value: 0.15 };
  s.employerPlan.espp.discount = 0.15;
  const c = Profile.limitCheck(s, "espp");
  assertEqual(c.global, 25000);
  assertClose(c.limit, 21250, 1e-9);
  // 15% of $130,000.
  assertClose(c.used, 19500, 1e-9);
  assert(c.approx, "the stock-value limit is approximate in contributions");
});

test("items without an IRS limit have no check", () => {
  const s = scenario();
  s.uploads.elections.health = fixed(24);
  assertEqual(Profile.limitCheck(s, "health"), null);
  assertEqual(Profile.limitCheck(s, "allowance"), null);
});

// Someone who started contributing mid-year: $2,000 in by the Sep 4 paystub,
// then $500 on each of the 8 remaining biweekly paychecks of 2026.
function midYearStarter() {
  const Projection = require("../projection");
  let s = scenario({ age: 35 });
  s.taxProfile.settings.state = "CA";
  s.compensation.firstPayday = "2026-09-04";
  s.uploads.records.push({
    id: "a",
    date: "2026-09-04",
    kind: "regular",
    periodStart: "2026-08-18",
    periodEnd: "2026-08-31",
    netPay: 3000,
    current: { salary: 5000, traditional: 500, hsa: 100 },
    ytd: { salary: 85000, traditional: 2000, hsa: 300 },
    benefits: [],
  });
  s.uploads.elections = {
    traditional: { mode: "fixed", value: 500, sourceDate: "2026-09-04" },
    hsa: { mode: "fixed", value: 100, sourceDate: "2026-09-04" },
  };
  s = Scenario.normalize(s);
  const result = Projection.calculate(s);
  return { s, totals: Profile.yearTotals(result.rows[1].payroll) };
}

test("a mid-year start counts year-to-date plus the remaining paychecks", () => {
  const { s, totals } = midYearStarter();
  // $2,000 so far + 8 x $500, not $500 x 26.
  assertEqual(totals.traditional, 6000);
  // $300 so far + 8 x $100.
  assertEqual(totals.hsa, 1100);
  const c = Profile.limitCheck(s, "traditional", totals);
  assertEqual(c.used, 6000);
  assertEqual(c.ytd, 2000);
  assertEqual(c.ytdDate, "2026-09-04");
  assertEqual(c.remaining, 18500);
  assert(
    c.notes.some((n) => n.includes("$2,000")),
    "a note says how much is already in this year",
  );
  assertEqual(Profile.limitCheck(s, "hsa", totals).used, 1100);
});

test("year totals keep amounts over a limit so the check can flag them", () => {
  const { s } = midYearStarter();
  const Projection = require("../projection");
  s.uploads.elections.traditional.value = 3000;
  const totals = Profile.yearTotals(Projection.calculate(s).rows[1].payroll);
  // $2,000 + 8 x $3,000 = $26,000 requested; payroll stops at $24,500.
  assertEqual(totals.traditional, 26000);
  const c = Profile.limitCheck(s, "traditional", totals);
  assert(c.over);
  assertEqual(c.remaining, -1500);
});
