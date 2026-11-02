const {
  describe,
  test,
  assert,
  assertClose,
  assertEqual,
} = require("./harness");
const P = require("../paystub-parser"),
  C = require("../compensation"),
  S = require("../scenario"),
  E = require("../equity-schedule"),
  Profile = require("../profile"),
  Presentation = require("../presentation");

// Synthetic Workday-style payslips. Salary is $78,000 biweekly ($3,000 per
// check); the RSU vest is $10,000 withheld at 22% federal and 6.85% NY.
const header = (begin, end, check) =>
  `Pay Period Begin Pay Period End Check Date\n${begin} ${end} ${check}\nCurrent and YTD Totals`;
const regular = (check, ytdSalary, phone = "50.00 ") =>
  `${header("08/01/2026", "08/14/2026", check)}
Current 0.00 3,050.00 0.00 683.33 0.00 2,366.67
YTD 0.00 ${(ytdSalary + 10000 + 200).toLocaleString("en-US", { minimumFractionDigits: 2 })} 0.00 6,000.00 6,350.00 ${(ytdSalary + 10000 + 200 - 12350).toLocaleString("en-US", { minimumFractionDigits: 2 })}
Earnings
Regular Salary 3,000.00 ${ytdSalary.toLocaleString("en-US", { minimumFractionDigits: 2 })}
Phone Stipend ${phone}200.00
RSU Distribution 10,000.00
Employee Taxes
OASDI 189.10 2,200.00
Medicare 44.23 800.00
Federal Withholding 300.00 2,000.00
State Tax - NY 150.00 1,000.00
Post Tax Deductions
RSU Stock Deposit 6,350.00`;
// The phone stipend isn't on this check, so its current cell is blank.
const regularWithout = (check, ytdSalary) =>
  regular(check, ytdSalary, "")
    .replace(
      "Current 0.00 3,050.00 0.00 683.33",
      "Current 0.00 3,000.00 0.00 683.33",
    )
    .replace("0.00 2,366.67", "0.00 2,316.67");
const vest = `${header("08/01/2026", "08/14/2026", "08/15/2026")}
Current 0.00 10,000.00 0.00 3,650.00 6,350.00 0.00
YTD 0.00 58,200.00 0.00 6,000.00 6,350.00 45,850.00
Earnings
Regular Salary 48,000.00
Phone Stipend 200.00
RSU Distribution 08/01/2026 - 08/14/2026 0.00 0.00 10,000.00 10,000.00
Employee Taxes
OASDI 620.00 2,200.00
Medicare 145.00 800.00
Federal Withholding 2,200.00 2,000.00
State Tax - NY 685.00 1,000.00
Post Tax Deductions
RSU Stock Deposit 6,350.00 6,350.00`;
const bonus = `${header("03/01/2026", "03/14/2026", "03/13/2026")}
Current 0.00 7,800.00 0.00 2,250.30 0.00 5,549.70
YTD 0.00 22,800.00 0.00 5,000.00 0.00 17,800.00
Earnings
Regular Salary 15,000.00
Annual Bonus 7,800.00 7,800.00
Employee Taxes
OASDI 483.60 1,400.00
Medicare 113.10 400.00
Federal Withholding 1,716.00 2,500.00
State Tax - NY (62.40) 700.00`;
const parse = (text, existing = []) => P.parse([{ page: 1, text }], existing);

describe("off-cycle RSU checks", () => {
  test("an RSU-only payslip reconciles and is an equity check", () => {
    const r = parse(vest);
    assertEqual(r.kind, "equity");
    assertClose(r.current.rsu, 10000);
    assertClose(r.current.rsuOffset, 6350);
    assertClose(r.netPay, 0);
    assert(P.validate(r).valid, P.validate(r).errors.join(" "));
  });
  test("it gives supplemental withholding rates but never salary or elections", () => {
    const pay = parse(regular("08/14/2026", 48000)),
      rsu = parse(vest);
    const c = C.merge(C.defaults(), { frequency: "biweekly" });
    const s = P.suggest([pay, rsu], c, { today: new Date(2026, 8, 1) });
    // $3,000 per check × 26.
    assertClose(s.salary, 78000);
    assertEqual(s.record.date, "2026-08-14");
    assertClose(s.inferred["taxProfile.settings.rsuFederalRate"].value, 0.22);
    assertClose(s.inferred["taxProfile.settings.rsuStateRate"].value, 0.0685);
    assertEqual(
      s.inferred["taxProfile.settings.rsuFederalRate"].sourceDate,
      "2026-08-15",
    );
  });
  test("an RSU check uploaded alone fills rates and leaves salary unset", () => {
    const s = S.defaults(),
      records = [parse(vest)];
    const suggestion = P.suggest(records, S.engineInput(s));
    const out = Profile.applyUpload(s, records, suggestion, true).scenario;
    assertEqual(out.compensation.salary, 0);
    // Its NY withholding line still names the state.
    assertEqual(out.taxProfile.settings.state, "custom");
    assertClose(out.taxProfile.settings.rsuFederalRate, 0.22);
    assertEqual(
      out.uploads.fieldSources["taxProfile.settings.rsuStateRate"].sourceDate,
      "2026-08-15",
    );
  });
  test("a regular check and a vest on the same date both import", () => {
    const pay = parse(regular("08/15/2026", 48000)),
      rsu = parse(vest);
    assertEqual(P.mergeRecords([pay], [rsu]).length, 2);
  });
  test("RSU check withholding is not spread over earlier salary checks", () => {
    // A $2,000 YTD federal total, of which $2,200 came from the vest, would
    // otherwise be read as salary withholding; here the regular check's YTD
    // ($2,000 + 2,200 vest) leaves $1,700 for the unuploaded earlier checks.
    const pay = parse(regular("08/28/2026", 51000)),
      rsu = parse(vest);
    pay.ytd.federal = 4200;
    const c = C.merge(C.defaults(), {
      salary: 78000,
      frequency: "biweekly",
      firstPayday: "2026-01-09",
      tax: { state: "none" },
      payroll: { records: [pay, rsu] },
    });
    const r = C.calculate(c),
      before = r.paychecks.filter((p) => p.date < "2026-08-28");
    assertClose(
      before.reduce((n, p) => n + p.federal, 0),
      4200 - 300 - 2200,
      0.01,
    );
    assert(r.paychecks.every((p) => p.kind !== "equity"));
  });
});

describe("off-cycle bonus checks", () => {
  test("a bonus-only payslip sets bonus timing, size and withholding", () => {
    const b = parse(
      bonus
        .replace("(62.40)", "390.00")
        .replace("2,250.30", "2,702.70")
        .replace("5,549.70", "5,097.30"),
    );
    assertEqual(b.kind, "bonus");
    assert(P.validate(b).valid, P.validate(b).errors.join(" "));
    const pay = parse(regular("08/14/2026", 48000)),
      c = C.merge(C.defaults(), { frequency: "biweekly" });
    const s = P.suggest([b, pay], c, { today: new Date(2026, 8, 1) });
    assertEqual(s.inferred["compensation.bonusMonth"].value, 3);
    // $7,800 of $78,000.
    assertClose(s.inferred["compensation.bonusPercent"].value, 0.1);
    assertClose(s.inferred["taxProfile.settings.bonusFederalRate"].value, 0.22);
    assertClose(s.inferred["taxProfile.settings.bonusStateRate"].value, 0.05);
    assertClose(s.salary, 78000);
  });
});

describe("benefit cadence across uploads", () => {
  const plan = (texts) =>
    P.benefitPlans(texts.map((t) => parse(t))).find(
      (b) => b.label === "Phone Stipend",
    );
  test("a stipend on every uploaded check is per paycheck", () => {
    const p = plan([
      regular("07/17/2026", 42000),
      regular("07/31/2026", 45000),
    ]);
    assertEqual(p.schedule, "paycheck");
    assertClose(p.current, 50);
  });
  test("a stipend on the first check of each month is monthly", () => {
    const p = plan([
      regular("07/03/2026", 39000),
      regularWithout("07/17/2026", 42000),
      regular("08/14/2026", 48000),
      regularWithout("08/28/2026", 51000),
    ]);
    assertEqual(p.schedule, "monthly");
    // The latest check without it doesn't zero the amount.
    assertClose(p.current, 50);
    assertEqual(p.anchorMonth, 8);
  });
  test("payments three months apart are quarterly", () => {
    const p = plan([
      regular("04/10/2026", 21000),
      regularWithout("05/08/2026", 27000),
      regular("07/10/2026", 39000),
    ]);
    assertEqual(p.schedule, "quarterly");
    assertEqual(p.anchorMonth, 7);
  });
  test("a stipend seen only in YTD asks for another paystub", () => {
    const p = plan([regularWithout("08/14/2026", 48000)]);
    assertEqual(p.schedule, "paycheck");
    assert(/upload a paycheck that includes it/.test(p.hint));
  });
  test("a schedule the user chose is kept", () => {
    const records = [
      regular("07/17/2026", 42000),
      regular("07/31/2026", 45000),
    ].map((t) => parse(t));
    for (const r of records) {
      const line = r.lines.find((l) => l.label === "Phone Stipend");
      line.schedule = "annual";
      line.scheduleSet = true;
      P.rebuild(r);
    }
    assertEqual(
      P.benefitPlans(records).find((b) => b.label === "Phone Stipend").schedule,
      "annual",
    );
  });
  test("off-cycle checks don't change a benefit's cadence", () => {
    const p = plan([
      regular("07/31/2026", 45000),
      regular("08/14/2026", 48000),
      vest,
    ]);
    assertEqual(p.schedule, "paycheck");
  });
  test("a quarterly benefit is forecast only in its quarter months", () => {
    const records = [
      regular("04/10/2026", 21000),
      regularWithout("05/08/2026", 27000),
      regular("07/10/2026", 39000),
    ].map((t) => parse(t));
    const c = C.merge(C.defaults(), {
      salary: 78000,
      frequency: "biweekly",
      firstPayday: "2026-01-09",
      tax: { state: "none" },
      payroll: { records, useYtd: false },
    });
    const r = C.calculate(c),
      later = r.paychecks.filter((p) => p.date > "2026-07-10");
    const months = later
      .filter((p) => p.taxableAllowance > 0)
      .map((p) => p.date.slice(0, 7));
    // July anchors it: the next payment is October's first check.
    assertEqual(months.join(","), "2026-10");
    assertClose(
      later.reduce((n, p) => n + p.taxableAllowance, 0),
      50,
    );
  });
  test("quarterly schedules and RSU amounts survive export", () => {
    const s = S.defaults(),
      r = parse(vest);
    s.uploads.records = [r, parse(regular("08/14/2026", 48000))];
    s.uploads.records[1].benefits[0].schedule = "quarterly";
    const copy = S.normalize(JSON.parse(S.serialize(s)));
    assertClose(copy.uploads.records[0].current.rsu, 10000);
    assertClose(copy.uploads.records[0].current.rsuOffset, 6350);
    assertEqual(copy.uploads.records[1].benefits[0].schedule, "quarterly");
  });
});

describe("what RSU uploads tell the user", () => {
  test("vest history counts YTD vests that weren't uploaded", () => {
    // A $10,000 vest uploaded, $20,000 YTD on a later regular check.
    const pay = parse(regular("08/28/2026", 51000));
    pay.ytd.rsu = 20000;
    const h = P.vestHistory([parse(vest), pay], 2026);
    assertClose(h.ytd, 20000);
    assertEqual(h.vests.length, 1);
    assertEqual(h.interval, null);
  });
  test("a starter grant repeats the latest vest and covers the earlier one", () => {
    const pay = parse(regular("08/28/2026", 51000));
    pay.ytd.rsu = 20000;
    const g = Profile.grantFromVests(P.vestHistory([parse(vest), pay], 2026));
    const vests = E.vests(g);
    // Quarterly by default; one earlier $10,000 vest falls in May.
    assertEqual(vests[0].date, "2026-05-15");
    assertEqual(vests[1].date, "2026-08-15");
    assertClose(vests[0].value, 10000);
    assertEqual(vests.length, 16);
  });
  test("two vests set the interval", () => {
    const may = parse(vest.replace(/08\/15\/2026/, "05/15/2026"));
    const h = P.vestHistory([may, parse(vest)], 2026);
    assertEqual(h.interval, 3);
  });
  test("RSU income without grants is a gap; adding a grant closes it", () => {
    const s = S.defaults();
    s.uploads.records = [parse(vest)];
    assert(Presentation.missing(s).some((m) => m.id === "rsu"));
    assert(
      Presentation.learned(s).some(
        (r) => r.label === "RSU vests so far this year",
      ),
    );
    s.compensation.grants = [
      Profile.grantFromVests(P.vestHistory(s.uploads.records, 2026)),
    ];
    assert(!Presentation.missing(s).some((m) => m.id === "rsu"));
  });
  test("hints ask for the paystub that closes each gap", () => {
    const pay = parse(regular("08/14/2026", 48000));
    pay.ytd.rsu = 10000;
    const ids = (records) => P.uploadHints(records).map((h) => h.id);
    const onlyRegular = P.uploadHints([pay]);
    assertEqual(ids([pay]).join(","), "previous,rsu");
    const rsu = onlyRegular.find((h) => h.id === "rsu");
    assertEqual(rsu.ask, "An RSU vest payslip");
    assert(/\$10,000 of RSU income/.test(rsu.gap));
    assert(/Off-cycle/.test(rsu.tip));
    assertEqual(ids([parse(vest)]).join(","), "regular");
    assert(!ids([pay, parse(vest)]).includes("rsu"));
  });
  test("a bonus in YTD asks for the payslip that paid it", () => {
    const pay = parse(regular("08/14/2026", 48000));
    pay.ytd.bonus = 7800;
    const b = P.uploadHints([pay]).find((h) => h.id === "bonus");
    assert(/\$7,800 bonus/.test(b.gap));
  });
  test("benefits seen only in YTD are one combined ask", () => {
    const h = P.uploadHints([
      parse(regularWithout("07/31/2026", 45000)),
      parse(regularWithout("08/14/2026", 48000)),
    ]);
    // Their YTD also shows RSU income.
    assertEqual(h.map((x) => x.id).join(","), "rsu,benefit");
    assertEqual(h[1].ask, "A paycheck that includes Phone Stipend");
  });
  test("nothing to ask once every gap is covered", () => {
    assertEqual(
      P.uploadHints([
        parse(regular("07/31/2026", 45000)),
        parse(regular("08/14/2026", 48000)),
        parse(vest),
      ]).length,
      0,
    );
  });
});
