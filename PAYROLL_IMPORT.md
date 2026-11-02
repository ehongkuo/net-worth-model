# Paystub import

Open **Your profile → Your paychecks** and select regular-paycheck PDFs. Extraction stays in the browser. Review the check date, category mappings, current amounts and YTD amounts. All printed totals must reconcile before Apply is enabled.

Applying an upload saves reviewed observations and updates recurring elections. Updating annual salary, pay frequency and payday anchor is a separate checkbox, selected initially. Two check dates can establish a weekly or biweekly schedule; otherwise the estimate uses the selected frequency and asks for confirmation. Recurring employer HSA funding follows the uploaded per-check amount. A YTD-only employer retirement match is not treated as a recurring payment. Grant schedules, IRA contributions and ESPP plan terms remain in Complete the picture.

The newest uncapped regular paycheck supplies the recurring election. Percentage deductions use eligible salary and bonus; fixed deductions remain per paycheck. A later upload replaces older rates. If a check has reached an annual cap, the last uncapped election is retained rather than treating a capped zero as a new election.

The forecast applies IRS limits first and tighter employer limits next. Employer HSA funding consumes the same statutory HSA allowance. Employer retirement additions consume the combined plan limit. Limits reset by calendar year.

YTD is cumulative history, not another payment. The calendar reconciles unobserved earlier checks to YTD and labels them as history estimates. Uploading earlier paychecks replaces estimates with observations. The monthly view includes an expandable paycheck table for audit.

Federal withholding can use the uploaded federal taxable-wage rate. State withholding uses gross salary and bonus when a state taxable-wage basis is unavailable. Payroll taxes follow statutory rules; the tax engine separately calculates annual liability and the remaining settlement.

The parser supports recognized text-based payroll tables, with manual category mapping. Unsupported layouts, scanned documents, unreconciled totals and negative adjustments require corrected inputs. Same-date conflicting observations are rejected; correct or remove the old observation in a scenario export before reimporting.

Applying uploads fills observed plan participation and the ESPP rate. Recurring retirement and HSA elections appear in their plan sections; benefits and withholding remain visible in the paycheck-derived numbers. Source dates identify uploaded or inferred values. Explicit edits are retained across later uploads, with conflicts reported after Apply. Annual contribution overrides remain subject to IRS and plan limits.


## Off-cycle checks

RSU vests and bonuses are often paid on their own payslip. A check with no
salary is classified as an RSU vest (RSU income) or a bonus check. Off-cycle
checks never supply salary, pay schedule or recurring elections. An RSU check's
income is offset by a post-tax "stock deposit" line for the shares delivered, so
it nets to zero cash.

An RSU check supplies the federal and state withholding rates on vests; a bonus
check supplies bonus rates, month and size. Vests themselves are forecast from
grants: the RSU check is not a payroll row, and its withholding is excluded from
the YTD amounts spread over earlier salary checks. When RSU income appears
without a grant, setup offers a starting grant that repeats the latest vest every
vesting interval for four years.

After reading, a pop-up names each gap the paystubs leave and the paystub that
would close it: the previous regular check, an RSU or bonus payslip that YTD
totals imply, and benefits seen only in YTD. Paystubs added from it join the
same review. It opens again only when the gaps change, and the list stays in
the review.

## Benefit elections

Reviewed benefit entries preserve their printed label, category, current amount,
YTD, recurrence and optional employer annual cap. Matching uses both payroll
section and label. A later upload reuses that classification; a changed section
requires review. Transit and parking require a schedule choice before import.
Across two or more regular uploads, a benefit paid on every check repeats every
paycheck; otherwise the typical gap between payments sets monthly, quarterly or
annual, anchored to the months it was paid. A schedule you choose is kept.
Monthly deductions run on the first scheduled paycheck of each month. A zero on
a later paycheck does not cancel a monthly election. Choose “This payment only”
when a payment should not recur.

Coverage, services and restricted-benefit deductions appear as red spending.
Retirement and HSA contributions keep their asset categories. Noncash coverage
stays out of cash and asset totals; taxable imputed benefits affect wages only.
Taxable cash allowances are separate from nontaxable reimbursements.

Restricted funding is counted as spending when deducted. The expense budget must
exclude purchases funded from those deductions. This release does not track
individual restricted-account reimbursements or forfeitures.

Older saved uploads retain their aggregate benefit amounts. Re-upload the source
PDF to recover individual labels and schedules; the old scenario did not store
that detail.

## Ongoing versus dated forecasts

The ongoing monthly view and tax tab use a full-year estimate at current salary
and elections. The same calculation engine reapplies annual limits and taxes.
YTD does not reduce that salary rate. The calendar tables and lifetime projection
retain the recorded current-year history and forecast remaining paychecks.
Earlier dated rows reconstructed from YTD remain labeled `history-estimate`.
They are estimates, not evidence of a hire date or individual historical checks.
