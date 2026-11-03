const { test, assert, assertClose, assertEqual } = require("./harness");
const Scenario = require("../scenario");
const Projection = require("../projection");

// Synthetic mid-year hire, paid every two weeks on Fridays from Mar 6, 2026.
// By the Sep 4 paystub: 14 paychecks of $5,000 salary, a $950 401(k)
// deduction on 13 of them (it started with the 2nd check), and a $40 medical
// deduction on all 14. 2026 has 26 biweekly Fridays (Jan 9 through Dec 25);
// Sep 4 is the 18th, so 17 checks precede it and 8 follow it.
const REGULAR = {
  id: "sep4",
  date: "2026-09-04",
  kind: "regular",
  periodStart: "2026-08-24",
  periodEnd: "2026-09-06",
  netPay: 3000,
  current: { salary: 5000, traditional: 950, health: 40, federal: 600 },
  ytd: { salary: 70000, traditional: 12350, health: 560, federal: 8400 },
  benefits: [],
};
function scenario(records = [REGULAR]) {
  const s = Scenario.defaults();
  s.taxProfile.year = 2026;
  s.taxProfile.settings.state = "CA";
  Object.assign(s.compensation, {
    salary: 130000,
    frequency: "biweekly",
    firstPayday: "2026-09-04",
  });
  s.uploads.records = records;
  s.uploads.elections = {
    traditional: { mode: "fixed", value: 950, sourceDate: "2026-09-04" },
  };
  return Scenario.normalize(s);
}
const calendar = (s) =>
  Projection.calculate(s).rows[1].payroll.payrollCalendar.rows.filter((r) =>
    r.date.startsWith("2026"),
  );
const on = (rows, date) => rows.find((r) => r.date === date);

test("year-to-date that is a whole number of paychecks dates when pay started", () => {
  const rows = calendar(scenario());
  // $70,000 / $5,000 = 14 paychecks: Mar 6 through Sep 4.
  assertEqual(on(rows, "2026-02-20").salary, 0);
  assertEqual(on(rows, "2026-03-06").salary, 5000);
  assertEqual(
    rows.filter((r) => r.date <= "2026-09-04" && r.salary > 0).length,
    14,
  );
  // $12,350 / $950 = 13 deductions: Mar 20 through Sep 4, none on Mar 6.
  assertEqual(on(rows, "2026-03-06").traditional, 0);
  assertEqual(on(rows, "2026-03-20").traditional, 950);
  assertEqual(
    rows.filter((r) => r.date <= "2026-09-04" && r.traditional > 0).length,
    13,
  );
  // The medical deduction ran on all 14 paychecks.
  assertEqual(on(rows, "2026-03-06").health, 40);
});

test("the year total is year-to-date plus the remaining paychecks", () => {
  const rows = calendar(scenario());
  const total = (k) =>
    Math.round(rows.reduce((n, r) => n + (r[k] || 0), 0) * 100) / 100;
  // $12,350 + 8 x $950.
  assertEqual(total("traditional"), 19950);
  // $70,000 + 8 x $5,000.
  assertEqual(total("salary"), 110000);
});

test("no paycheck before the inferred start withholds tax", () => {
  const rows = calendar(scenario());
  for (const r of rows.filter((x) => x.date < "2026-03-06"))
    for (const k of ["federal", "state", "ss", "medicare"])
      assertEqual(r[k] || 0, 0, `${k} on ${r.date}`);
});

test("year-to-date that isn't a whole number of paychecks is spread evenly", () => {
  const s = scenario([
    { ...REGULAR, ytd: { ...REGULAR.ytd, traditional: 12000 } },
  ]);
  const rows = calendar(s);
  // $12,000 - $950 = $11,050 over the 13 earlier paychecks since Mar 6.
  const earlier = rows.filter(
    (r) => r.date >= "2026-03-06" && r.date < "2026-09-04",
  );
  assertEqual(earlier.length, 13);
  assertClose(
    earlier.reduce((n, r) => n + r.traditional, 0),
    11050,
    0.005,
  );
  assert(earlier.every((r) => Math.abs(r.traditional - 850) < 0.01));
});

test("an off-cycle payslip whose year-to-date includes the next paycheck isn't double counted", () => {
  // RSU payslip dated Sep 17 for the Sep 7-20 period. Its YTD already
  // includes the regular Sep 18 paycheck: one more $5,000 and $950.
  const rsu = {
    id: "rsu",
    date: "2026-09-17",
    kind: "equity",
    periodStart: "2026-09-07",
    periodEnd: "2026-09-20",
    netPay: 0,
    current: { rsu: 10000, rsuOffset: 6000 },
    ytd: {
      salary: 75000,
      traditional: 13300,
      health: 600,
      federal: 9000,
      rsu: 10000,
    },
    benefits: [],
  };
  const rows = calendar(scenario([REGULAR, rsu]));
  const sep18 = on(rows, "2026-09-18");
  assert(sep18.source !== "forecast", "Sep 18 is already in the YTD");
  assertEqual(sep18.traditional, 950);
  const total = rows.reduce((n, r) => n + (r.traditional || 0), 0);
  // $13,300 + 7 x $950, the same year as without the RSU payslip.
  assertClose(total, 19950, 0.005);
});
