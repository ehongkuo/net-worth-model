const {
  describe,
  test,
  assert,
  assertClose,
  assertEqual,
} = require("./harness");
const P = require("../paystub-parser"),
  S = require("../scenario"),
  Profile = require("../profile");

// Synthetic payslips: $210,000 paid twice a month is $8,750 a check, 20
// checks by Oct 31. The annual bonus is 15%, $31,500, on its own check.
const header = (begin, end, check) =>
  `Pay Period Begin Pay Period End Check Date\n${begin} ${end} ${check}\nCurrent and YTD Totals`;
const semimonthly = `${header("10/16/2026", "10/31/2026", "10/31/2026")}
Current 0.00 8,750.00 0.00 1,000.00 0.00 7,750.00
YTD 0.00 206,500.00 0.00 24,000.00 0.00 182,500.00
Earnings
Regular Salary 8,750.00 175,000.00
Annual Bonus 31,500.00
Employee Taxes
Federal Withholding 1,000.00 24,000.00
Employer Paid Benefits
401(k) Employer Match 437.50 8,750.00`;
const bonus = `${header("02/20/2026", "03/05/2026", "03/06/2026")}
Current 0.00 31,500.00 0.00 6,930.00 0.00 24,570.00
YTD 0.00 66,500.00 0.00 9,730.00 0.00 56,770.00
Earnings
Regular Salary 35,000.00
Annual Bonus 31,500.00 31,500.00
Employee Taxes
Federal Withholding 6,930.00 9,730.00`;
const parse = (text) => P.parse([{ page: 1, text }]);
const check = (date, periodStart, periodEnd, salary, ytdSalary) => ({
  date,
  kind: "regular",
  periodStart,
  periodEnd,
  current: { salary },
  ytd: { salary: ytdSalary },
});

describe("pay schedule from one paystub", () => {
  test("the pay period length names the schedule", () => {
    const f = (start, end, date) =>
      P.payFrequency([check(date, start, end, 1000, 0)], "biweekly");
    assertEqual(
      f("2026-10-16", "2026-10-31", "2026-10-31").frequency,
      "semimonthly",
    );
    assertEqual(
      f("2026-10-01", "2026-10-15", "2026-10-15").frequency,
      "semimonthly",
    );
    assertEqual(
      f("2026-10-11", "2026-10-24", "2026-10-30").frequency,
      "biweekly",
    );
    assertEqual(
      f("2026-10-19", "2026-10-25", "2026-10-30").frequency,
      "weekly",
    );
    assertEqual(
      f("2026-10-01", "2026-10-31", "2026-10-31").frequency,
      "monthly",
    );
    assert(!f("2026-10-16", "2026-10-31", "2026-10-31").guessed);
  });

  test("without period dates, year-to-date pay counts the checks", () => {
    // $175,000 / $8,750 is 20 checks by Oct 31: twice a month, not 22 biweekly.
    const r = P.payFrequency(
      [check("2026-10-31", "", "", 8750, 175000)],
      "biweekly",
    );
    assertEqual(r.frequency, "semimonthly");
    assert(!r.guessed);
  });

  test("with nothing to go on, the schedule is a guess", () => {
    // Started mid-year: 8 checks by Oct 23 fits no full-year schedule.
    const r = P.payFrequency(
      [check("2026-10-23", "", "", 3769.23, 30153.84)],
      "biweekly",
    );
    assertEqual(r.frequency, "biweekly");
    assert(r.guessed);
  });

  test("two checks two weeks apart still win over the period", () => {
    const r = P.payFrequency(
      [
        check("2026-10-16", "2026-10-01", "2026-10-15", 1000, 0),
        check("2026-10-30", "2026-10-16", "2026-10-31", 1000, 0),
      ],
      "monthly",
    );
    assertEqual(r.frequency, "biweekly");
  });

  test("a semimonthly paystub sets salary to 24 checks", () => {
    const records = [parse(bonus), parse(semimonthly)];
    const s = S.defaults();
    const suggestion = P.suggest(records, S.engineInput(s));
    assertEqual(suggestion.frequency, "semimonthly");
    assertEqual(suggestion.salary, 210000);
    assertClose(suggestion.inferred["compensation.bonusPercent"].value, 0.15);
    const out = Profile.applyUpload(s, records, suggestion, true).scenario;
    assertEqual(out.compensation.frequency, "semimonthly");
    assertEqual(out.compensation.salary, 210000);
    assertEqual(out.employerPlan.retirement.employerAnnual, 437.5 * 24);
  });
});

// Uploaded without period dates or a full year of YTD, the schedule falls back
// to every two weeks: 26 x $8,750 = $227,500 and a 13.8% bonus.
function guessedUpload() {
  const records = [parse(bonus), parse(semimonthly)];
  for (const r of records) {
    r.periodStart = r.periodEnd = "";
    r.ytd.salary = 0;
  }
  const s = S.defaults();
  const suggestion = P.suggest(records, S.engineInput(s));
  return Profile.applyUpload(s, records, suggestion, true).scenario;
}

describe("fixing the pay schedule updates what came from it", () => {
  test("a guessed schedule is marked for review", () => {
    const s = guessedUpload();
    assertEqual(s.compensation.frequency, "biweekly");
    assertEqual(s.compensation.salary, 227500);
    assertEqual(
      Profile.fieldState(s, "compensation.frequency").kind,
      "inferred",
    );
  });

  test("changing it recalculates salary, employer funding and bonus", () => {
    const s = guessedUpload();
    assertClose(s.compensation.bonusPercent, 0.138);
    Profile.edit(s, "compensation.frequency", "semimonthly");
    assertEqual(s.compensation.salary, 210000);
    assertEqual(s.employerPlan.retirement.employerAnnual, 437.5 * 24);
    assertClose(s.compensation.bonusPercent, 0.15);
    // Still the paystub's numbers, not the user's.
    assert(!s.uploads.manualFields.includes("compensation.salary"));
  });

  test("a salary the user entered is kept", () => {
    const s = guessedUpload();
    Profile.edit(s, "compensation.salary", 200000);
    Profile.edit(s, "compensation.frequency", "semimonthly");
    assertEqual(s.compensation.salary, 200000);
    // The bonus percent follows the user's salary: $31,500 / $200,000.
    assertClose(s.compensation.bonusPercent, 0.158);
  });

  test("a bonus percent the user entered is kept", () => {
    const s = guessedUpload();
    Profile.edit(s, "compensation.bonusPercent", 0.2);
    Profile.edit(s, "compensation.frequency", "semimonthly");
    assertClose(s.compensation.bonusPercent, 0.2);
  });
});

describe("an estimated grant keeps its vest value", () => {
  // Vests of $12,500 every quarter, the latest on Aug 17.
  const history = {
    vests: [{ date: "2026-08-17", value: 12500 }],
    interval: 3,
    ytd: 12500,
  };
  const estimated = () => {
    const s = S.defaults();
    s.compensation.grants = [Profile.grantFromVests(history)];
    return S.normalize(s);
  };
  const E = require("../equity-schedule");

  test("entering the grant price changes shares, not dollars", () => {
    const s = estimated();
    assertClose(E.vests(s.compensation.grants[0])[0].value, 12500);
    Profile.edit(s, "compensation.grants.0.grantPrice", 50);
    const g = s.compensation.grants[0];
    assertEqual(g.vestPrice, 50);
    assertClose(E.vests(g)[0].value, 12500);
    // $12,500 / $50 = 250 shares a vest.
    assertClose(E.vests(g)[0].shares, 250);
  });

  test("a vest price the user entered is kept", () => {
    const s = estimated();
    Profile.edit(s, "compensation.grants.0.vestPrice", 70);
    Profile.edit(s, "compensation.grants.0.grantPrice", 50);
    assertEqual(s.compensation.grants[0].vestPrice, 70);
  });

  test("placeholder prices don't set the slider's range", () => {
    const s = estimated();
    s.employerPlan.espp = {
      ...s.employerPlan.espp,
      enabled: true,
      purchasePrice: 30,
    };
    s.uploads.manualFields = ["employerPlan.espp.purchasePrice"];
    // The grant's $100 is a placeholder; the ESPP price was entered.
    assertEqual(Profile.sharePrice(s).price, 30);
    Profile.edit(s, "compensation.grants.0.grantPrice", 50);
    assertEqual(Profile.sharePrice(s).price, 50);
  });
});
