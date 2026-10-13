const {
  describe,
  test,
  assert,
  assertClose,
  assertEqual,
} = require("./harness");
const P = require("../paystub-parser");
const fixture = `Pay Period Begin Pay Period End Check Date
08/24/2026 09/06/2026 09/04/2026
Current and YTD Totals
Current 0.00 6,386.15 1,408.52 1,660.65 1,903.86 1,413.12
YTD 0.00 89,126.10 18,334.84 23,731.82 19,050.59 28,008.85
Earnings
Description Dates Hours Rate Amount YTD
Regular Salary 08/24/2026 80.00 0.00 6,346.15 88,846.10
Connectivity Allowance 40.00 280.00
Group Term Life - Imputed 0.00 0.00 7.75 100.75
Other Imputed Income 77.00
Employee Taxes
OASDI 381.37 5,354.57
Medicare 89.19 1,252.28
Federal Withholding 753.58 10,887.85
State Tax - CA 354.22 5,084.78
CA SDI - CASDI 82.29 1,152.34
Pre Tax Deductions
401(k) Pre-Tax 1,205.77 15,675.01
HSA 178.75 2,323.83
Medical 24.00 336.00
Post Tax Deductions
401(k) Mega Back Door Roth 951.93 12,375.09
ESPP 951.93 6,663.51
Gym Membership 11.99
Employer Paid Benefits
401(k) Employer Match 1,500.00
HSA Employer 30.77 430.78
Medical ER 319.48 4,472.72
Taxable Wages
OASDI - Taxable Wages 6,151.15 86,364.02
Medicare - Taxable Wages 6,151.15 86,364.02
Federal Withholding - Taxable Wages 4,945.38 70,689.01`;
describe("paystub review parser", () => {
  test("extracts check date, blank current cells, and reconciles a complete payroll", () => {
    const r = P.parse([{ page: 1, text: fixture }]);
    assertEqual(r.date, "2026-09-04");
    assertClose(r.current.salary, 6346.15);
    assertClose(r.current.imputed, 7.75);
    assertClose(r.ytd.imputed, 177.75);
    assertClose(r.current.employer, 0);
    assertClose(r.ytd.employer, 1500);
    assertClose(r.netPay, 1413.12);
    assert(P.validate(r).valid);
    assert(
      r.lines.some((l) => l.label === "Gym Membership" && l.current === null),
    );
  });
  test("unknown labels require mapping and wrong totals cannot be accepted", () => {
    const r = P.parse([
      { page: 1, text: fixture.replace("Medical 24.00", "Mystery 24.00") },
    ]);
    assert(!P.validate(r).valid);
    r.lines.find((l) => l.label === "Mystery").key = "health";
    P.rebuild(r);
    assert(P.validate(r).valid);
    r.netPay += 10;
    assert(!P.validate(r).valid);
  });
  test("deduplicates normalized checks without relying on filenames", () => {
    const a = P.parse([{ page: 1, text: fixture }]);
    a.id = "one";
    assertEqual(P.mergeRecords([a], [{ ...a, id: "two" }]).length, 1);
  });
  test("a corrected check requires explicit replacement", () => {
    const a = P.parse([{ page: 1, text: fixture }]);
    a.id = "one";
    let rejected = false;
    try {
      P.mergeRecords([a], [{ ...a, id: "two", netPay: 1000 }]);
    } catch {
      rejected = true;
    }
    assert(rejected);
  });
});
