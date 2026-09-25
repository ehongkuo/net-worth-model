# Net worth model

A local financial model built from one exportable scenario. It has three views: Monthly flow, Tax model and Lifetime projection.

## Setup

Empty scenarios open a welcome page with setup and import actions. Result views become available after adding salary, a stock grant or uploaded earnings. Returning users with income open Monthly flow.

Open **Your profile** to build or update the scenario.

1. **About you:** tax year, age, filing status and state.
2. **Your paychecks:** upload regular paystubs, review the extracted totals and apply them. Two checks can establish a weekly or biweekly schedule.
3. **Complete the picture:** review questions prompted by the uploads, then add plan restrictions, ESPP terms, bonus or stock grants that the paychecks cannot establish.

The latest paycheck preview separates deposited cash, retirement/HSA funding and pending ESPP contributions. **Your numbers and where they come from** shows observed amounts, inferred rates and statutory limits. Detailed setup remains available in collapsed sections. Profile cards label uploaded values, manual settings and assumptions to confirm. Employer funding separates reported YTD from projected remaining contributions; grant previews show the first vest at grant and assumed market prices. Monthly flow distinguishes the annual salary rate from the calendar-year forecast. Displayed dollar totals use cents and percentages use one decimal place; stored inputs and calculations retain their precision. Assumption cards can be confirmed without creating a payroll override. Confirmations survive export/import and are invalidated if the confirmed value changes.

Starting balances, expenses, retirement timing, inflation and investment returns sit under Lifetime assumptions. Uploaded observations are preserved. Future deductions use the observed elections, subject to IRS and employer limits.

## Run

```sh
npm ci
npm start
npm test
```

Open http://127.0.0.1:5190. The server uses a fixed port and serves an explicit allowlist of app files. PDFs are parsed locally. Scanned PDFs require OCR and are not supported by this importer.

## Scenario as the source of truth

**Inspect scenario** shows the version 3 input document. **Export scenario** downloads it; importing the same file reproduces the calculations. Exports contain reviewed paycheck amounts, not raw PDF text, parser review metadata, undo snapshots or computed results.

Older `{config, events}` exports migrate on load. The original saved document is retained locally and can be downloaded from Inspect scenario. Life events are excluded with a notice. The original browser storage key is left intact. A new scenario key is written only after a successful edit or import.

Personal presets can be imported through the scenario importer. The app does not automatically populate new sessions from the ignored `development-defaults.js` file. Saved browser data is preserved.

## Calculation path

| File | Responsibility |
| --- | --- |
| `scenario.js` | Input schema, validation, export and legacy migration |
| `profile.js` | Onboarding preview, schedule inference and follow-up questions |
| `paystub-parser.js` | Reviewed observations and recurring election inference |
| `payroll-calendar.js` | Dated paychecks, YTD reconciliation and contribution caps |
| `compensation.js` | Calendar aggregation, RSU/ESPP activity and cash flow |
| `tax-engine.js` | Tax rules, liability, attribution and payment reconciliation |
| `projection.js` | Annual asset growth, contributions, spending and drawdowns |
| `money-flow.js`, `compact-flow.js` | Accounting presentation and the compact Sankey |
| `app.js`, `tax-ui.js` | Scenario editor and three result views |

The app calculates one projection result after an input change. Monthly flow and Tax model read its first projected year. Lifetime projection reads the annual rows, beginning with an exact starting-balance snapshot. View changes do not rerun the financial model.

## Boundaries

- Payroll withholding and final tax liability are separate. The monthly ledger includes an evenly allocated planning settlement for their difference.
- Paychecks round to cents. Summing dated paychecks can differ from an unrounded annual withholding estimate.
- Lifetime returns are nominal; today's-dollar display deflates each year-end balance. Expenses inflate from the starting annual amount.
- Surplus cash remains cash. Drawdowns use cash, taxable investments, company equity, pre-tax retirement, then Roth. HSA and pending ESPP funding are reserved.
- Forced company-equity sales do not yet calculate new sale taxes or track individual cost-basis lots. Social Security uses the existing 85% taxable-income approximation. These are planning assumptions.
- The statutory engine currently supports single and married filing jointly, California, no state income tax, or a configured effective state rate. Future limits are projections.

Stock-price connections, life events and standalone ESPP/paycheck pages have been removed from this version. ESPP setup and paycheck reconciliation remain part of the core workflow.

See [Scenario format](SCENARIO.md), [Paystub import](PAYROLL_IMPORT.md) and [Tax rules](TAX_RULES.md).
