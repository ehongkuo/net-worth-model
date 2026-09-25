# Compensation and tax rules

The browser uses `tax-engine.js` for tax-year limits, annual tax liability, bracket allocations, federal W-4 withholding and payment reconciliation. `compensation.js` calculates compensation, account contributions and payroll transactions against that engine. `tax-ui.js` explains the same result used in the monthly flow. `projection.js` computes the shared annual results from the versioned scenario. The monthly, tax and lifetime views consume those same results.

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

ESPP rules are generic configuration: offering dates and duration, contribution range, annual payroll cap, discount, lookback, share cap, fractional shares and participation. There are no employer presets. Existing saved numerical settings remain unchanged. Each offering supports opt-in/out and optional rate, price and purchase-date overrides. New scenarios have no employer share cap by default; the Section 423 statutory FMV allowance still applies.

The $25,000 Section 423 allowance limits grant-date fair market value of shares, not their purchase cost or later market value. At $10 grant-date FMV, the annual allowance permits 2,500 shares. A $15 purchase-date FMV values those shares at $37,500. Skipping an earlier offering preserves unused allowance but does not create an exemption. This model intentionally does not assume cross-year accumulation of purchase rights. See [Treasury regulation 1.423-2(i)](https://www.irs.gov/irb/2009-49_IRB).

Weekend purchase prices use the preceding weekday; market holiday dates can be supplied in plan configuration, or purchase dates overridden per offering. The model does not fetch an exchange holiday calendar. Mid-offering payroll processing delays, the one-decrease administration rule and termination refund processing lags are not simulated. Employment-end refunds are assigned to the termination month. Pennsylvania purchase-time state taxation is not implemented.

New RSU grants default to selling enough shares to cover estimated RSU withholding. The retained equity excludes those shares, and paycheck cash pays only the remaining withholding. Existing explicit hold/sell choices are preserved. Final tax liability remains separate from withholding and is reconciled through the tax reserve or estimated overpayment. The model uses monthly wage aggregation to allocate Social Security and Medicare withholding; exact intra-month payroll order can differ.

## Tax explorer and cash reconciliation

The Taxes tab shows annual nominal tax-year dollars, regardless of the projection purchasing-power toggle. Bracket rows expose lower and upper bounds, income allocated to each bracket, rate and tax. Source-colored ordinary-income bars subtract pre-tax contributions from the compensation funding them, then stack income sources in a labeled order. Household deductions appear below the bars. They do not assign legal tax priority to salary, bonus or RSUs. Long-term capital gains stack above ordinary taxable income using their preferential schedule.

Federal nonrefundable income-tax credits reduce regular income tax and modeled AMT, but do not erase NIIT. User tax adjustments remain explicit overrides. The calculation includes the ordinary and capital-gains bracket taxes, modeled AMT, applied credits, NIIT, state tax and employee payroll taxes. Credit eligibility must be determined before entering the amount.

The optional federal W-4 method follows the current-form percentage-method structure in [Publication 15-T](https://www.irs.gov/publications/p15t): annual taxable salary, W-4 income and deduction adjustments, filing status/multiple-jobs schedules and annual credits. Supplemental wages retain their separately configured withholding rates. Payroll HSA means a qualifying Section 125 salary reduction. A direct HSA contribution only changes paycheck withholding through an explicit W-4 adjustment. Spouse withholding defaults to the same filing/multiple-jobs setting with no additional credits or deductions, and has an annual-dollar override. Legacy annual-tax withholding remains available and is preserved by default; state withholding is still an estimate.

Total liability minus cash withholding, RSU sell-to-cover and estimated tax payments equals remaining liability. The additional-tax reserve is the positive remainder. Estimated payments are cash already paid, not another tax liability. The ESPP sale-tax impact is a counterfactual calculation with sale ordinary income and capital gains removed, using the final projection tax context. It is explanatory and is never added to taxes twice.

The optional future-ESPP-tax reserve uses newly purchased held lots, an assumed sale price and holding period, and the current tax profile. It is an earmark on cash, so it reduces unallocated cash but does not reduce net worth or become current tax liability. This is an annual funding illustration, not a separate cumulative reserve account or a tax-payment calendar. Actual future rates, income and sales can differ.

SALT can use entered state/local income tax and SDI payments instead of the legacy liability estimate. Property taxes from the projection are added separately. California state brackets remain a clearly labeled projection of 2025 tables. Custom state rates, special deduction eligibility, senior provisions, qualified dividends, investment income outside modeled capital gains, multi-state allocation and state AMT are not fully automated.

## Tax source attribution and payment reconciliation

`TaxEngine.attribute` returns one set of annual source amounts for the tax explorer, monthly source summary, and Sankey payment ribbons. Ordinary income is stacked in displayed source order after payroll-source deductions. Remaining household deductions are allocated proportionally for the tax attribution. Each source's federal bracket slices are summed before grouping cash compensation, RSUs, ESPP sales, and other income. Preferential gains keep their own schedule. This allocation explains the combined tax bill; it is not a separate legal assessment of each income source.

Federal adjustments follow regular bracket-tax shares, state taxes follow gross source shares, and RSU payroll taxes retain the payroll engine's vest-date wage-cap calculation. Remaining payroll tax is allocated among cash wages. Every category reconciles to the final projection tax result, including credits and additional income.

Withholding and share-sale elections stay unchanged. RSU withholding paid in cash is identified separately from sell-to-cover. Estimated payments are allocated by liability. Positive and negative source balances net against each other, and additional-reserve ribbons partition only the remaining household shortfall. The monthly-average view uses these same amounts divided by 12. Current-month mode uses scheduled compensation, vesting, ESPP transactions and withholding from the month-by-month table; annual estimated payments, settlement and future-tax reserves remain divided by 12 as planning allocations.

The backdoor IRA explanation shows the contribution, existing basis, pre-tax IRA balance used, nontaxable conversion and taxable conversion. A clean nondeductible contribution with no pre-tax IRA balance remains nontaxable. The model still uses an annual pro-rata estimate rather than a full Form 8606 ledger.

## Period views and automatic rules

The current-month Sankey preserves the monthly ledger's cash result and keeps retained shares in equity. Income and funding join before deductions and tax payments; account funding reaches the final asset column. Amortized amounts are labeled throughout the average view.

The two income bars show gross ordinary income and income after pre-tax contributions and benefits. Standard or itemized deductions and other household adjustments appear separately below, leading to final ordinary taxable income. Their visible arithmetic excludes taxes. Tax calculations, payments and after-tax cash/equity appear below the income chart. The standard or itemized deduction reduces taxable income without creating a cash expense. Chart domains follow displayed amounts with 6% headroom.

California HSA nonconformity applies automatically, including when an older scenario saved the former conformity override. No-state mode has no state income tax. Custom-state mode remains an effective-rate estimate using federal HSA deductibility; it does not identify or implement another jurisdiction's rules.

The backdoor Roth explanation identifies starting Traditional / SEP / SIMPLE IRA balances and additional pre-tax IRA balances separately, then shows the combined pro-rata input. New scenarios start with zero traditional IRA balance. Saved balances remain unchanged. See [IRS Form 8606 instructions](https://www.irs.gov/instructions/i8606).

Conditional fields are hidden and disabled when irrelevant, without erasing saved elections. Held ESPP shares hide sale inputs unless a future-tax reserve needs an assumed sale price. Optional employment dates and employer payroll contribution caps remain available in expandable sections. The payroll dollar cap is separate from the statutory grant-date fair-market-value share allowance.

## Illustrative cost allocation

The ordered Sankey removes synthetic payroll/budget funding sources. It separates pre-tax contributions and benefits from tax payments, then shows cash and asset destinations before allocating costs in a sixth column. Costs consume current-period cash, ESPP value, RSU value and retirement funding in that order. HSA assets and future-tax cash reserves remain excluded from general expenses.

This view does not withdraw existing balances, sell equity or recalculate taxes. The underlying monthly ledger and lifetime projection are unchanged. Cost allocation links are labeled hypothetical. Costs exceeding eligible flows remain an explicit shortfall rather than becoming invented income. Where tax payments or configured transfers already exceed available economic value, the diagram reports the unmet amounts and constrains visual transfers to conserve flow.

## Payroll source attribution and overview

Traditional 401(k) deductions follow the payroll election's salary, bonus and RSU eligibility, using the same eligible-compensation weights as payroll. HSA and pre-tax benefits reduce salary in the presentation. Source deduction amounts never exceed that source's gross income. The household adjustment reconciles the remaining reduction to final taxable income, including standard/itemized deductions, losses and any deduction exceeding its assigned source. It is allocated proportionally only when attributing tax liability by source. This changes source attribution without changing total tax, withholding or projected balances.

California's income bars exclude federal-only income, include employer HSA funding and do not deduct employee HSA funding. State household deductions remain separate from payroll-source deductions.

Sankey colors describe the current category: blue cash (including bonuses), gold equity (RSUs and ESPP), purple retirement/HSA, and red taxes/costs. Bands change category at account or tax destinations. Pooled ribbons can contain several categories; adjacent segments of the same category merge without changing values. The source allocation underneath remains illustrative and does not establish a new sale or withholding election. Closed filled curves replace thick strokes.

The cash overview uses after-tax cash before living costs, living costs, and their difference before hypothetical asset use. Asset additions use the underlying flow before visual expense allocation. Current-month salary follows the scheduled paycheck count; the average uses annual salary divided by 12. Both views preserve annual salary.


## Payroll benefit limits

2026 healthcare FSA salary reductions use $3,400; transit and parking each use
$340 per month. Future indexed values use the scenario's limit-growth assumption.
Dependent-care exclusions use $7,500 federally, constrained by household earned
income in the supported filing profiles. California retains $5,000; the model
adds the federal excess back to California income. Eligibility is assumed when a
reviewed deduction is classified in one of these categories. Employer caps may
reduce the statutory amount. Recorded payroll amounts are preserved.

Sources: [IRS Publication 15-B](https://www.irs.gov/publications/p15b) and
[FTB federal conformity, section 70404](https://www.ftb.ca.gov/about-ftb/data-reports-plans/summary-of-federal-income-tax-changes/index.html).
