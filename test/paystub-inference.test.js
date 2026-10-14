const { test, assert, assertClose, assertEqual } = require("./harness");
const fs = require("fs"),
  path = require("path");
const P = require("../paystub-parser"),
  Profile = require("../profile"),
  Scenario = require("../scenario");
// Reuse the reconciling Workday-style fixture from the parser tests.
const fixture = fs
  .readFileSync(path.join(__dirname, "paystub-parser.test.js"), "utf8")
  .match(/const fixture = `([\s\S]*?)`;/)[1];
const second = fixture
  .replace(
    "08/24/2026 09/06/2026 09/04/2026",
    "09/07/2026 09/20/2026 09/18/2026",
  )
  .replace("Regular Salary 08/24/2026", "Regular Salary 09/07/2026");
const parse = (text, id = "a") =>
  Object.assign(P.parse([{ page: 1, text }]), { id });
const suggest = (...texts) => {
  const s = Scenario.defaults();
  return P.suggest(
    texts.map((t, i) => parse(t, "r" + i)),
    Scenario.engineInput(s),
  );
};
const inferred = (sug, p) => sug.inferred[p]?.value;

test("salary snaps to the annual figure that per-check rounding implies", () => {
  // 6,346.15 × 26 = 164,999.90, which is 165,000 rounded to cents per check.
  assertEqual(suggest(fixture, second).salary, 165000);
});
test("tax year and state come from the check date and withholding line", () => {
  const sug = suggest(fixture, second);
  assertEqual(inferred(sug, "taxProfile.year"), 2026);
  assertEqual(inferred(sug, "taxProfile.settings.state"), "CA");
  const ny = suggest(fixture.replace("State Tax - CA", "State Tax - NY"));
  assertEqual(inferred(ny, "taxProfile.settings.state"), "custom");
  assertClose(
    inferred(ny, "taxProfile.settings.customStateRate"),
    5084.78 / 88846.1,
    0.0001,
  );
  const wa = suggest(fixture.replace("State Tax - CA", "State Tax - WA"));
  assertEqual(inferred(wa, "taxProfile.settings.state"), "none");
});
test("HSA funding above the self-only limit infers family coverage", () => {
  // (178.75 + 30.77) × 26 = 5,448 > 4,400 self-only, ≤ 8,750 family.
  assertEqual(
    inferred(suggest(fixture, second), "employerPlan.hsa.coverage"),
    "family",
  );
  // 100 + 30.77 per check = 3,400/year: self-only is possible, so no inference.
  const low = fixture
    .replace("HSA 178.75 2,323.83", "HSA 100.00 1,300.00")
    .replace("HSA Employer 30.77 430.78", "HSA Employer 30.77 430.78");
  assert(!suggest(low).inferred["employerPlan.hsa.coverage"]);
});
test("printed filing status is used; married filing separately is not assumed", () => {
  const married = suggest("Marital Status: Married\n" + fixture);
  assertEqual(inferred(married, "taxProfile.settings.filing"), "married");
  const separate = suggest(
    "Federal Filing Status: Married filing separately\n" + fixture,
  );
  assert(!separate.inferred["taxProfile.settings.filing"]);
});
test("a bonus on a check gives the bonus month and size", () => {
  const bonus = fixture.replace(
    "Connectivity Allowance",
    "Annual Bonus 16,500.00 16,500.00\nConnectivity Allowance",
  );
  const sug = suggest(bonus);
  assertEqual(inferred(sug, "compensation.bonusMonth"), 9);
  assertClose(inferred(sug, "compensation.bonusPercent"), 0.1, 0.0001);
});
test("applying an upload records inferred values with an Inferred label, and keeps your settings", () => {
  const records = P.mergeRecords([], [parse(fixture, "a"), parse(second, "b")]);
  let s = Scenario.defaults();
  const sug = P.suggest(records, Scenario.engineInput(s));
  const out = Profile.applyUpload(s, records, sug, true).scenario;
  assertEqual(out.employerPlan.hsa.coverage, "family");
  assertEqual(
    Profile.fieldState(out, "employerPlan.hsa.coverage").label,
    "Inferred",
  );
  assertEqual(
    Profile.fieldState(out, "compensation.salary").label,
    "From paystub",
  );
  // A value the user set by hand is never overwritten by an inference.
  s = Scenario.defaults();
  s.employerPlan.hsa.coverage = "single";
  s.uploads.manualFields = ["employerPlan.hsa.coverage"];
  const kept = Profile.applyUpload(s, records, sug, true);
  assertEqual(kept.scenario.employerPlan.hsa.coverage, "single");
  assert(kept.conflicts.some((c) => c.includes("employerPlan.hsa.coverage")));
});
test("family coverage keeps the full HSA election in the forecast", () => {
  const records = P.mergeRecords([], [parse(fixture, "a"), parse(second, "b")]);
  const s = Scenario.defaults();
  const out = Profile.applyUpload(
    s,
    records,
    P.suggest(records, Scenario.engineInput(s)),
    true,
  ).scenario;
  const p = require("../projection").calculate(out).ongoing.payroll;
  // Employee + employer HSA funding stays within the family limit, not capped at 4,400.
  assert(p.contributions.hsa + p.contributions.hsaEmployer > 4400);
});
