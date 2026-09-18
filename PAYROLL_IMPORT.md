# Payroll setup and imports

Open **Setup & limits** to configure tax eligibility, employer restrictions and funding, then review uploaded paychecks. **Paychecks** shows the dated forecast. Monthly cash flow and the lifetime projection use that calendar when enabled.

## Limit precedence

Published 2026 IRS limits anchor the model. Later years use the existing growth assumptions. Custom statutory overrides can lower a contribution limit, but cannot raise the baseline. Employer restrictions are separate configuration fields.

- Traditional and designated Roth 401(k) contributions share employee deferral capacity.
- After-tax workplace contributions use the smaller of remaining combined-plan capacity and the optional employer mega cap. Employer retirement funding is reserved before allocating this capacity. A blank mega cap adds no restriction; zero stops new after-tax contributions.
- Employee HSA capacity reserves configured annual employer HSA funding and accounts for eligibility and prior contributions.
- ESPP payroll caps limit deductions. The separate grant-date FMV allowance limits share purchases through the offering engine. It is not a $25,000 payroll-dollar cap.

Imported elections continue at their observed pace until a cap is reached. The final contribution is partial if necessary. Existing annual elections remain available when an imported election is removed. Fixed-dollar elections remain fixed in future years; percentage elections follow eligible cash compensation.

## Calendar and actuals

The calendar uses integer cents for paycheck contributions and preserves imported values. Forecast withholding is recalculated after contribution changes. Salary and RSU events share the Social Security wage cap. Final annual tax liability remains separate from payroll withholding.

YTD is a cumulative snapshot, not another payment. When YTD reconciliation is enabled, the engine distributes unobserved history over estimated earlier pay dates and labels those rows **History estimate**. Their monthly timing is not established by a recent paystub. Disable YTD reconciliation for a full-year run-rate experiment. Uploading older statements progressively replaces estimates with observed checks.

Uploaded checks match scheduled pay periods even when a bank deposit anchor differs from the printed check date. Future-dated documents are labeled scheduled. Weekly and biweekly schedules follow the anchor; semimonthly schedules use the 15th and month end. Bank holidays are not shifted automatically.

The paycheck deposit excludes IRA transfers, direct HSA transfers, living expenses and separate equity transactions. Those remain in monthly cash flow. The paycheck page lists RSU vesting and ESPP purchases separately.

## PDF review and privacy

PDF.js reads text in the browser using a locally served worker. The server does not receive documents. The first supported layout has earnings, employee taxes, pre-tax deductions, post-tax deductions, employer benefits, and current/YTD columns. Scanned PDFs and negative correction checks are explicitly rejected pending broader support.

Review shows the source label, mapped category, editable current/YTD values, source page, and check date. Gross-to-net and section totals must reconcile for both current and YTD before applying. Blank current cells are distinct from YTD-only balances. Unknown labels require a selection; mappings are saved with the scenario for reuse.

Imputed benefits enter taxable wages without creating cash or investment assets. Cash allowances default to the reviewed tax treatment; confirm their category. Employer medical coverage is preserved as a benefit observation and does not become an investment contribution.

Only normalized financial records and their source hash/page references are saved. Original PDFs, employee identifiers, addresses and bank details are not persisted. Records are part of the existing local scenario storage and JSON export. Undo restores the prior compensation configuration, including after reload; the original documents are not needed. Individual records can also be removed without reverting subsequent settings.

Importing records is separate from applying inferred contribution elections or updating salary/frequency/anchor. Employer annual funding, grant schedules and plan participation remain under user control. Same-date conflicting regular statements require removing the old record before applying a correction.

## Verification

`npm test` includes independent expected values for caps, a partial final paycheck, HSA employer reservations, 27-paycheck years, YTD reconciliation, statutory ceilings, equity/payroll wage-base coordination, ESPP funding, direct HSA transfers, parser reconciliation, missing cells, duplicate imports and conflicting revisions.

The supplied two-page regular paystub layout was also exercised end to end in an isolated browser. No personal source documents are included in the repository. No formatter or linter is configured; JavaScript syntax and `git diff --check` are checked separately.
