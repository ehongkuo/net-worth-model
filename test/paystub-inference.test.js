const { test, assert, assertClose, assertEqual } = require("./harness");
const fs = require("fs"),
  path = require("path");
const P = require("../paystub-parser"),
  Profile = require("../profile"),
  Presentation = require("../presentation"),
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
// Year-to-date HSA funding of 5,323.83 + 430.78 = 5,754.61, above self-only + catch-up.
const familyHsa = (t) =>
  t.replace("HSA 178.75 2,323.83", "HSA 178.75 5,323.83");
const today = new Date("2026-10-14T12:00:00Z");
const parse = (text, id = "a") =>
  Object.assign(P.parse([{ page: 1, text }]), { id });
const suggest = (texts, options = {}) =>
  P.suggest(
    [].concat(texts).map((t, i) => parse(t, "r" + i)),
    Scenario.engineInput(Scenario.defaults()),
    { today, ...options },
  );
const inferred = (sug, p) => sug.inferred[p]?.value;

test("salary snaps to the annual figure that per-check rounding implies", () => {
  // 6,346.15 × 26 = 164,999.90, which is 165,000 rounded to cents per check.
  assertEqual(suggest([fixture, second]).salary, 165000);
});
test("tax year is inferred only from a check in the current calendar year", () => {
  assertEqual(inferred(suggest(fixture), "taxProfile.year"), 2026);
  assert(
    !suggest(fixture, { today: new Date("2027-01-10T12:00:00Z") }).inferred[
      "taxProfile.year"
    ],
    "last year's check does not move the tax year",
  );
  const december2025 = fixture.replace(
    "08/24/2026 09/06/2026 09/04/2026",
    "12/08/2025 12/21/2025 12/19/2025",
  );
  assert(
    !suggest(december2025, { today: new Date("2025-12-20T12:00:00Z") })
      .inferred["taxProfile.year"],
    "years before the engine's range are never inferred",
  );
});
test("state comes from recognized state income tax lines from several vendors", () => {
  const cases = {
    "State Tax - CA": "CA",
    "CA State Income Tax": "CA",
    "STATE INCOME TAX CA": "CA",
    "CA SIT": "CA",
    "ST WH CA": "CA",
    "California Withholding": "CA",
    "OR State Income Tax": "custom",
    "NY State Income Tax": "custom",
    "State Tax - WA": "none",
  };
  for (const [label, expected] of Object.entries(cases)) {
    const sug = suggest(fixture.replace("State Tax - CA", label));
    assertEqual(inferred(sug, "taxProfile.settings.state"), expected, label);
  }
  // Disability, unemployment and family-leave lines are not income tax.
  const sdi = parse(fixture).lines.find((l) => l.label === "CA SDI - CASDI");
  assertEqual(sdi.key, "sdi");
});
test("federal and local withholding are never classified as state tax", () => {
  const key = (label) =>
    parse(
      fixture.replace("Federal Withholding 753", `${label} 753`),
    ).lines.find((l) => l.label === label)?.key;
  for (const label of [
    "FIT Withholding",
    "Fed Withholding",
    "Fed Income Tax",
    "FITW",
  ])
    assertEqual(key(label), "federal", label);
  // Paylocity prints Medicare as "FED MED/EE".
  const med = parse(
    fixture.replace("Medicare 89.19", "FED MED/EE 89.19"),
  ).lines.find((l) => l.label === "FED MED/EE");
  assertEqual(med.key, "medicare");
  for (const label of ["NYC Withholding", "Local Withholding", "City Tax"])
    assertEqual(key(label), "local", label);
  assertEqual(key("Withholding Tax"), null);
});
test("local tax reconciles and becomes its own rate, not the state's", () => {
  // The CA line relabelled as city tax: same amounts, so totals still match.
  const text = fixture.replace(
    "State Tax - CA 354.22",
    "NYC Withholding 354.22",
  );
  const record = parse(text);
  assertEqual(record.current.local, 354.22);
  assert(P.validate(record).valid, P.validate(record).errors.join("; "));
  const sug = suggest(text);
  assertEqual(inferred(sug, "taxProfile.settings.customStateRate"), undefined);
  assertEqual(inferred(sug, "taxProfile.settings.state"), undefined);
  const wages =
    (record.ytd.salary || 0) + (record.ytd.bonus || 0) + (record.ytd.rsu || 0);
  assertClose(
    inferred(sug, "taxProfile.settings.localRate"),
    5084.78 / wages,
    0.0001,
  );
  // The model adds it to state tax and to each check's withholding.
  const s = Scenario.defaults();
  s.compensation.salary = 120000;
  s.taxProfile.settings.state = "none";
  const before = require("../projection").calculate(s).ongoing.payroll;
  s.taxProfile.settings.localRate = 0.03;
  const after = require("../projection").calculate(s).ongoing.payroll;
  assert(
    after.taxes.state > before.taxes.state + 1000,
    "local tax is modelled",
  );
  assert(after.withholding > before.withholding + 1000, "and withheld");
});
test("a missing or unrecognized state line is never read as no state tax", () => {
  const noLine = fixture.replace(/State Tax - CA .*\n/, "");
  assert(!suggest(noLine).inferred["taxProfile.settings.state"]);
  const odd = fixture.replace("State Tax - CA", "Mystery Levy");
  assert(!suggest(odd).inferred["taxProfile.settings.state"]);
});
test("custom state rate includes RSU income in the wage base", () => {
  const ny = fixture.replace("State Tax - CA", "NY State Income Tax");
  const r = parse(ny);
  r.ytd.rsu = 50000;
  const sug = P.suggest([r], Scenario.engineInput(Scenario.defaults()), {
    today,
  });
  assertClose(
    inferred(sug, "taxProfile.settings.customStateRate"),
    5084.78 / (88846.1 + 50000),
    0.0001,
  );
});
test("HSA family coverage needs year-to-date funding above self-only plus catch-up", () => {
  assertEqual(
    inferred(suggest(familyHsa(fixture)), "employerPlan.hsa.coverage"),
    "family",
  );
  // Annualized per-check funding alone (5,448/yr, YTD 2,964) proves nothing.
  assert(!suggest([fixture, second]).inferred["employerPlan.hsa.coverage"]);
  // 4,900 YTD: above self-only but within the age-55 catch-up, age unknown.
  const nearCap = fixture.replace("HSA 178.75 2,323.83", "HSA 178.75 4,469.22");
  assert(!suggest(nearCap).inferred["employerPlan.hsa.coverage"]);
  // Once the age is known to be under 55, the same funding proves family.
  assertEqual(
    inferred(
      suggest(nearCap, { locked: ["taxProfile.age"] }),
      "employerPlan.hsa.coverage",
    ),
    "family",
  );
});
test("printed withholding status is a starting guess; married filing separately is not assumed", () => {
  const married = suggest("Marital Status: Married\n" + fixture);
  assertEqual(inferred(married, "taxProfile.settings.filing"), "married");
  const separate = suggest(
    "Federal Filing Status: Married filing separately\n" + fixture,
  );
  assert(!separate.inferred["taxProfile.settings.filing"]);
});
test("only an annual or performance bonus is treated as recurring", () => {
  const withBonus = (label) =>
    suggest(
      fixture.replace(
        "Connectivity Allowance",
        `${label} 16,500.00 16,500.00\nConnectivity Allowance`,
      ),
    );
  const annual = withBonus("Annual Bonus");
  assertEqual(inferred(annual, "compensation.bonusMonth"), 9);
  assertClose(inferred(annual, "compensation.bonusPercent"), 0.1, 0.0001);
  assert(!withBonus("Sign-On Bonus").inferred["compensation.bonusPercent"]);
});
test("inferred values are labelled, survive saving, and never override set or confirmed values", () => {
  const records = P.mergeRecords(
    [],
    [
      parse(familyHsa(fixture), "a"),
      parse("Marital Status: Married\n" + familyHsa(second), "b"),
    ],
  );
  const run = (s) =>
    Profile.applyUpload(
      s,
      records,
      P.suggest(records, Scenario.engineInput(s), {
        today,
        locked: Profile.lockedPaths(s),
      }),
      true,
    );
  const out = run(Scenario.defaults()).scenario;
  assertEqual(out.employerPlan.hsa.coverage, "family");
  assertEqual(
    Profile.fieldState(out, "employerPlan.hsa.coverage").kind,
    "inferred",
  );
  assertEqual(
    Profile.fieldState(out, "compensation.salary").label,
    "From paystub",
  );
  const saved = Scenario.migrate(JSON.parse(Scenario.serialize(out))).scenario;
  assertEqual(
    Profile.fieldState(saved, "employerPlan.hsa.coverage").kind,
    "inferred",
  );
  // A manual setting is kept and reported.
  let s = Scenario.defaults();
  s.employerPlan.hsa.coverage = "single";
  s.uploads.manualFields = ["employerPlan.hsa.coverage"];
  assertEqual(run(s).scenario.employerPlan.hsa.coverage, "single");
  // A confirmed value is kept too, and stays confirmed rather than manual.
  s = Scenario.defaults();
  s.uploads.confirmedFields = { "taxProfile.settings.filing": "single" };
  const kept = run(s).scenario;
  assertEqual(kept.taxProfile.settings.filing, "single");
  assert(!kept.uploads.manualFields.includes("taxProfile.settings.filing"));
});
test("an inferred field renders an Inferred badge and a Confirm button", () => {
  const state = {
    kind: "inferred",
    label: "Inferred",
    basis: "HSA funding above the self-only limit",
  };
  const { badge, approve } = Presentation.fieldBadge(
    state,
    "employerPlan.hsa.coverage",
    "HSA coverage",
  );
  assert(badge.includes("Inferred") && badge.includes("self-only limit"));
  assert(approve.includes('data-confirm="employerPlan.hsa.coverage"'));
  const observed = Presentation.fieldBadge(
    { kind: "observed", label: "From paystub" },
    "compensation.salary",
    "Salary",
  );
  assertEqual(observed.badge + observed.approve, "");
});
test("family coverage keeps the full HSA election in the forecast", () => {
  const records = P.mergeRecords(
    [],
    [parse(familyHsa(fixture), "a"), parse(familyHsa(second), "b")],
  );
  const s = Scenario.defaults();
  const out = Profile.applyUpload(
    s,
    records,
    P.suggest(records, Scenario.engineInput(s), { today }),
    true,
  ).scenario;
  const p = require("../projection").calculate(out).ongoing.payroll;
  assert(p.contributions.hsa > 4400 - 800, "not capped at the self-only limit");
});
test("a confirmed value that the paystub contradicts is kept, reported, and can be switched", () => {
  const records = P.mergeRecords(
    [],
    [parse("Marital Status: Married\n" + fixture, "a")],
  );
  const s = Scenario.defaults();
  s.uploads.confirmedFields = { "taxProfile.settings.filing": "single" };
  const applied = Profile.applyUpload(
    s,
    records,
    P.suggest(records, Scenario.engineInput(s), {
      today,
      locked: Profile.lockedPaths(s),
    }),
    true,
  );
  assertEqual(applied.scenario.taxProfile.settings.filing, "single");
  const item = applied.kept.find(
    (k) => k.path === "taxProfile.settings.filing",
  );
  assert(item && item.yours === "single" && item.paystub === "married");
  const switched = Profile.usePaystubValue(applied.scenario, item);
  assertEqual(switched.taxProfile.settings.filing, "married");
  assert(!("taxProfile.settings.filing" in switched.uploads.confirmedFields));
  assertEqual(
    Profile.fieldState(switched, "taxProfile.settings.filing").kind,
    "inferred",
  );
  assertEqual(
    Presentation.formatValue("taxProfile.settings.filing", item.paystub),
    "Married filing jointly",
  );
});
test("keeping your value is remembered until the paystub suggests something new", () => {
  const married = P.mergeRecords(
    [],
    [parse("Marital Status: Married\n" + fixture, "a")],
  );
  const upload = (s, records) =>
    Profile.applyUpload(
      s,
      records,
      P.suggest(records, Scenario.engineInput(s), {
        today,
        locked: Profile.lockedPaths(s),
      }),
      true,
    );
  const s = Scenario.defaults();
  s.uploads.confirmedFields = { "taxProfile.settings.filing": "single" };
  const first = upload(s, married);
  const item = first.kept.find((k) => k.path === "taxProfile.settings.filing");
  const kept = Scenario.normalize(Profile.keepYourValue(first.scenario, item));
  assertEqual(
    kept.uploads.keptDecisions["taxProfile.settings.filing"],
    '"married"',
  );
  const again = upload(kept, married);
  assert(
    !again.kept.some((k) => k.path === "taxProfile.settings.filing"),
    "the same paystub value is not offered again",
  );
  assertEqual(again.scenario.taxProfile.settings.filing, "single");
  // Using the paystub value clears the decision.
  const used = Profile.usePaystubValue(kept, item);
  assert(!("taxProfile.settings.filing" in used.uploads.keptDecisions));
});
test("switching HSA coverage to the paystub's family value re-reads the HSA election", () => {
  const records = P.mergeRecords(
    [],
    [parse(familyHsa(fixture), "a"), parse(familyHsa(second), "b")],
  );
  const s = Scenario.defaults();
  s.employerPlan.hsa.coverage = "self";
  s.uploads.confirmedFields = { "employerPlan.hsa.coverage": "self" };
  const opts = (x) => ({ today, locked: Profile.lockedPaths(x) });
  const applied = Profile.applyUpload(
    s,
    records,
    P.suggest(records, Scenario.engineInput(s), opts(s)),
    true,
  );
  // Self-only coverage makes every check look capped, so no election.
  assert(!applied.scenario.uploads.elections.hsa?.value);
  const item = applied.kept.find((k) => k.path === "employerPlan.hsa.coverage");
  assertEqual(item.paystub, "family");
  const next = Profile.usePaystubValue(applied.scenario, item);
  Profile.applyElections(
    next,
    P.suggest(next.uploads.records, Scenario.engineInput(next), opts(next)),
  );
  assertClose(next.uploads.elections.hsa.value, 178.75, 0.01);
});
