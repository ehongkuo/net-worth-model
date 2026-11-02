const { test, assert, assertClose, assertEqual } = require("./harness");
const Profile = require("../profile");
const Scenario = require("../scenario");

// $130,000 salary paid every two weeks ($5,000 a check), 10% bonus target,
// with the bonus counting toward 401(k) contributions.
function scenario(frequency = "biweekly") {
  const s = Scenario.defaults();
  Object.assign(s.compensation, {
    salary: 130000,
    frequency,
    bonusPercent: 0.1,
  });
  s.employerPlan.retirement.bonusEligible = true;
  s.employerPlan.espp.bonusEligible = false;
  return s;
}

test("a percent election shows its per-paycheck and yearly amounts", () => {
  const s = scenario();
  const e = Profile.equivalents(s, "traditional", {
    mode: "percent",
    value: 0.08,
  });
  assertClose(e.percent, 0.08, 1e-9);
  // 8% of the $5,000 check.
  assertClose(e.check, 400, 1e-9);
  // 8% of salary plus the eligible $13,000 bonus.
  assertClose(e.year, 11440, 1e-9);
  assertClose(e.month, 11440 / 12, 1e-9);
  // The year exceeds 26 checks by the bonus share: 8% of $13,000.
  assertClose(e.year - e.check * e.checks, 1040, 1e-9);
  // ESPP here excludes the bonus: 8% of $130,000.
  assertClose(
    Profile.equivalents(s, "espp", { mode: "percent", value: 0.08 }).year,
    10400,
    1e-9,
  );
});

test("a per-paycheck amount converts to percent, month and year", () => {
  const e = Profile.equivalents(scenario(), "hsa", {
    mode: "fixed",
    value: 400,
  });
  assertClose(e.check, 400, 1e-9);
  assertClose(e.year, 10400, 1e-9);
  assertClose(e.month, 10400 / 12, 1e-9);
  assertClose(e.percent, 0.08, 1e-9);
  // Twice a month is 24 checks a year.
  assertClose(
    Profile.equivalents(scenario("semimonthly"), "hsa", {
      mode: "fixed",
      value: 400,
    }).year,
    9600,
    1e-9,
  );
});

test("whatever unit is entered is stored as an election the engine reads", () => {
  const s = scenario();
  Profile.setElection(s, "traditional", "year", 13000);
  const t = s.uploads.elections.traditional;
  assertEqual(t.mode, "fixed");
  assertEqual(t.unit, "year");
  assert(t.manual, "marked as the user's entry");
  // $13,000 over 26 checks, unrounded so the year reads back exactly.
  assertClose(t.value, 500, 1e-9);
  assertClose(Profile.equivalents(s, "traditional", t).year, 13000, 1e-9);

  Profile.setElection(s, "health", "month", 100);
  assertClose(s.uploads.elections.health.value, (100 * 12) / 26, 1e-9);
  assertClose(
    Profile.equivalents(s, "health", s.uploads.elections.health).month,
    100,
    1e-9,
  );

  Profile.setElection(s, "roth", "check", 250);
  assertEqual(s.uploads.elections.roth.mode, "fixed");
  assertEqual(s.uploads.elections.roth.value, 250);

  Profile.setElection(s, "espp", "percent", 0.06);
  assertEqual(s.uploads.elections.espp.mode, "percent");
  assertEqual(s.uploads.elections.espp.value, 0.06);
  assertEqual(s.employerPlan.espp.rate, 0.06);
});

test("a dollar ESPP election leaves the percent rate alone", () => {
  const s = scenario();
  s.employerPlan.espp.rate = 0.1;
  Profile.setElection(s, "espp", "check", 300);
  assertEqual(s.uploads.elections.espp.mode, "fixed");
  assertEqual(s.employerPlan.espp.rate, 0.1);
});

test("an election keeps its paystub date and survives a save round trip", () => {
  const s = scenario();
  s.uploads.elections.traditional = {
    mode: "percent",
    value: 0.05,
    sourceDate: "2026-09-04",
  };
  Profile.setElection(s, "traditional", "year", 6500);
  const back = Scenario.normalize(JSON.parse(Scenario.serialize(s)));
  const t = back.uploads.elections.traditional;
  assertEqual(t.unit, "year");
  assertEqual(t.sourceDate, "2026-09-04");
  assertClose(t.value, 250, 1e-9);
});

test("without a salary there is no percent equivalent", () => {
  const s = scenario();
  s.compensation.salary = 0;
  const e = Profile.equivalents(s, "hsa", { mode: "fixed", value: 100 });
  assertEqual(e.percent, null);
  assertEqual(e.year, 2600);
  const p = Profile.equivalents(s, "traditional", {
    mode: "percent",
    value: 0.1,
  });
  assertEqual(p.check, 0);
});

test("each item offers the units people actually have on hand", () => {
  assertEqual(
    Profile.amountUnits("traditional").join(","),
    "percent,check,year",
  );
  assertEqual(Profile.amountUnits("espp").join(","), "percent,check,year");
  assertEqual(Profile.amountUnits("hsa").join(","), "check,year");
  assertEqual(Profile.amountUnits("health").join(","), "check,month,year");
  assertEqual(Profile.amountUnits("allowance").join(","), "check,month,year");
});

test("an unknown entered unit is rejected on load", () => {
  const s = scenario();
  s.uploads.elections.hsa = { mode: "fixed", value: 100, unit: "week" };
  let error;
  try {
    Scenario.normalize(JSON.parse(Scenario.serialize(s)));
  } catch (e) {
    error = e;
  }
  assert(error, "unit must be one of the known units");
});
