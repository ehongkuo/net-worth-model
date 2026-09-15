# Compensation and tax rules

The browser uses `compensation.js` for compensation, account contributions, withholding estimates and annual tax estimates. `model.js` consumes the same results in the lifetime projection. Its original calculation path remains available for older programmatic callers without a compensation configuration.

## Published baseline

The starting year defaults to 2026. These federal values are published, not extrapolated:

| Limit | 2026 |
| --- | ---: |
| Employee traditional + Roth 401(k) | $24,500 |
| Total defined-contribution plan additions, excluding catch-up | $72,000 |
| Eligible plan compensation | $360,000 |
| General age-50 catch-up | $8,000 |
| Age-60 through age-63 catch-up | $11,250 |
| IRA | $7,500 |
| IRA age-50 catch-up | $1,100 |
| HSA self-only / family | $4,400 / $8,750 |
| HSA age-55 catch-up | $1,000 |
| Social Security wage base | $184,500 |

Sources: [IRS Notice 2025-67](https://www.irs.gov/pub/irs-drop/n-25-67.pdf), [HSA Revenue Procedure 2025-19](https://www.irs.gov/pub/irs-drop/rp-25-19.pdf), [SSA contribution base](https://www.ssa.gov/oact/COLA/cbb.html).

Federal brackets, standard deductions, capital-gain thresholds and AMT parameters use [Revenue Procedure 2025-32](https://www.irs.gov/irb/2025-45_IRB). SALT phase-out and the high-income itemized-deduction limitation follow the [2026 estimated-tax guidance](https://www.irs.gov/publications/p505).

California income tax starts with [2025 FTB tables](https://www.ftb.ca.gov/forms/2025/2025-540-booklet.html). The default 3% adjustment to 2026 is a user-editable projection, not a published 2026 table. California SDI defaults to the [published 2026 rate of 1.3%](https://edd.ca.gov/en/Payroll_Taxes/Rates_and_Withholding). Employer HSA contributions are included in CA income and SDI; employee HSA salary reductions do not reduce CA taxable income or SDI. See [FTB HSA adjustments](https://www.ftb.ca.gov/forms/2025/2025-540-ca-instructions.html) and [EDD employee benefits](https://edd.ca.gov/siteassets/files/pdf_pub_ctr/de231eb.pdf).

## Future limits

Three independent assumptions control projected contribution limits, tax brackets and the Social Security wage base. Elected contributions have their own growth rate. Raising a limit does not automatically raise an election unless its election-growth setting does so.

Projected contributions round down to policy-sized increments: $500 for regular 401(k) and IRA limits, $1,000 for the plan total, $50 for HSA limits. Social Security rounds to the nearest $300. These are scenario projections, not predictions of future IRS announcements. The user can override six principal limits for any selected year without changing other years.

Additional Medicare and NIIT thresholds, the ESPP statutory allowance and the HSA catch-up remain fixed. SALT follows the scheduled return to $10,000 in 2030. Tax rates remain constant. Future law changes are not forecast.

## Compensation and cash timing

- Salary is distributed across the calendar's weekly, biweekly, semimonthly or monthly paydays. Annual salary is conserved even in a 27-paycheck year. Actual employer treatment of such a year may differ.
- Bonus is a percentage of salary paid in a selected month. The model assumes a full-year employee; this is not a midyear payroll/YTD reconciliation service.
- A grant is total dollars over a number of years. Grant price determines shares; assumed vest price and company-stock growth determine vesting income. Grants can overlap or repeat annually.
- Vesting dates are anniversaries of the entered start date. A cliff catches up elapsed service, with the rest vesting at the chosen interval. A final partial interval vests at the end. Invalid cliff/duration combinations produce a note.
- Sold RSUs produce cash. Held RSUs remain a separate stock asset, with vesting taxes funded from cash. They are not automatically liquidated for retirement withdrawals. Existing vested shares before the starting year belong in initial account balances.
- Cash withholding is estimated separately from annual tax liability. Regular withholding uses an annualized estimate or user rate overrides. Supplemental federal withholding applies the $1 million threshold. This is not an implementation of every W-4 or DE-4 payroll method.

## Contributions

Traditional and Roth 401(k) share the employee limit. Employer contributions reduce room for after-tax contributions. Catch-up is additional to the plan total. Mega backdoor requires the plan-permission toggle; delayed conversion earnings are an estimate using company-stock growth and are added to taxable ordinary income.

Employer match assumes annual true-up and contributions proportional to eligible compensation. Employer-specific paycheck matching, front-loading, nondiscrimination restrictions and compensation definitions must be reflected in entered elections. Prior contributions reduce remaining room without being deducted from this forecast again. Prior-employer wages and withholding are not automatically reconstructed from those inputs.

HSA contributions share the coverage limit with employer funding and are prorated by eligible months. Payroll HSA contributions reduce federal FICA wages; direct contributions do not. The last-month-rule testing-period exception is not assumed. Enter only compatible FSA benefits and allowable payroll deductions.

Direct Roth IRA contributions apply an estimated income phase-out. Backdoor IRA conversions use entered pre-tax balance and basis for a pro-rata estimate. Update these inputs for each year's actual conversions; the app does not maintain Form 8606 basis history.

## ESPP

This integration adapts the local ESPP calculator's immediate-sale and holding comparisons into the shared engine, with editable plan inputs and actual purchase/sale dates. It models a Section 423 plan. Each purchase period starts a fresh offering. Overlapping offerings, resets and carryover purchase rights are not inferred.

Payroll deductions accumulate until purchase. The discount and optional lookback determine purchase price. The entered share cap and conservative annual grant-date FMV allowance cap purchases. Unused cash is refunded at purchase. Held lots stay invested until the chosen sale date; selling principal is not compensation.

Qualifying treatment requires both holding-period tests. The model separates ordinary income and adjusted-basis capital gain/loss. Section 423 disposition income is excluded from FICA. See [IRS Publication 525](https://www.irs.gov/publications/p525) and [Publication 15-B](https://www.irs.gov/publications/p15b).

## Boundaries

The tax engine supports single and married filing jointly, federal tax, California tax and an optional custom effective state rate. Credits are entered after eligibility and phase-outs. Manual tax adjustments cover cases outside the model. It does not calculate every filing status, senior deduction, CA AMT, dependent credit, investment-income category, self-employment tax or multi-state return.

Capital losses above the annual deduction carry forward as net losses in the lifetime projection; separate short- and long-term carryover character is simplified. The lifetime engine retains its existing Social Security and retirement assumptions. Monthly tables show compensation transactions; life-event cash, Social Security and retirement withdrawals are reflected in the lifetime projection.

Saved legacy values remain intact. The old annual RSU estimate becomes an explicitly labeled recurring grant; the old fixed ESPP gain stops being added automatically and prompts the user to configure the ESPP. Inputs persist through reload and scenario export/import.

Stock quotes use the configured free provider through the local server. Prices are cached, and applying a quote to a scenario is explicit.

🤖 Generated with Codex

## Automatic contributions and purchasing power

The simplified interface defaults to maximum employee 401(k), available mega backdoor room when enabled, employee HSA room after employer funding, and regular backdoor IRA contributions. Each can use custom elections instead. Maximums follow the selected year's limits and age-based catch-ups. Advanced prior-employer adjustments remain available. New after-tax contributions are assumed to convert immediately. Starting traditional IRA balances and additional external IRA balances feed the pro-rata estimate; year-end balances and basis still require review for an actual conversion.

The global display defaults to scenario-start purchasing power. Calculations use nominal dollars and statutory tax limits, then displayed projections are divided by cumulative inflation. Enter nominal growth assumptions: 10% growth and 2% inflation correspond to 7.84% real growth. Editable limits remain nominal even when the limits table displays purchasing power. Monthly cash-flow summaries divide annual totals by 12; the monthly schedule retains actual payment timing. ESPP discounted cost updates from independent offering-date and purchase-date market prices.

## Offering participation and sell-to-cover

The Own SoFi profile configures six-month offerings beginning December 9 and June 9, a 15% lookback discount, 1%-15% eligible-pay contributions, a 5,000-share purchase cap, fractional shares and a $21,250 annual payroll cap. Its initial enrollment date is editable and starts with the second offering for the supplied development scenario. Existing saved scenarios are not overwritten. Each offering supports an opt-in/out override and optional contribution rate, prices and purchase date. Future auto-enrollment is configurable. Employment dates filter payroll deductions.

The $25,000 Section 423 allowance limits grant-date fair market value of shares, not their purchase cost or later market value. At $10 grant-date FMV, the annual allowance permits 2,500 shares. A $15 purchase-date FMV values those shares at $37,500. Skipping an earlier offering preserves unused allowance but does not create an exemption. This model intentionally does not assume cross-year accumulation of purchase rights. See [Treasury regulation 1.423-2(i)](https://www.irs.gov/irb/2009-49_IRB).

Weekend purchase prices use the preceding weekday; market holiday dates can be supplied in plan configuration, or purchase dates overridden per offering. The model does not fetch an exchange holiday calendar. Mid-offering payroll processing delays, the one-decrease administration rule and termination refund processing lags are not simulated. Employment-end refunds are assigned to the termination month. Pennsylvania purchase-time state taxation is not implemented.

New RSU grants default to selling enough shares to cover estimated RSU withholding. The retained equity excludes those shares, and paycheck cash pays only the remaining withholding. Existing explicit hold/sell choices are preserved. Final tax liability remains separate from withholding and is reconciled through the tax reserve or estimated overpayment. The model uses monthly wage aggregation to allocate Social Security and Medicare withholding; exact intra-month payroll order can differ.
