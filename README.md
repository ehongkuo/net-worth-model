# Net worth model

A local financial model built from one exportable scenario. It has three views: Monthly flow, Tax model and Lifetime projection.

**Live site:** https://net-worth-model.sidequestapps.workers.dev

## Setup

Empty scenarios open a welcome page with setup and import actions. Result views become available after adding salary, a stock grant or uploaded earnings. Returning users with income open Monthly flow.

Open **Your profile** to build or update the scenario.

1. **Your paychecks:** upload regular paystubs and any RSU vest or bonus payslips, review the extracted totals and apply them. One paystub with pay-period dates sets the pay schedule.
2. **About you:** tax year, age, filing status and state. Quick questions prompted by the uploads (for example, a filing status guessed from withholding) are answered in place.
3. **Complete the picture:** plan restrictions, ESPP terms, bonus and stock grants that the paychecks cannot establish.

Values the app had to estimate are counted on each step. **Go through them** asks about each one on its own card, with a heading and hint that say what it is (for example, the RSU grant it belongs to). Next keeps or saves the value, Skip leaves it as an estimate and Stop ends the walkthrough. A kept value is recorded as confirmed; confirmations survive export/import and are invalidated if the value changes.

The latest paycheck preview separates deposited cash, retirement/HSA funding and pending ESPP contributions. **Your numbers and where they came from** shows observed amounts, inferred rates and statutory limits. Employer funding separates reported YTD from projected remaining contributions. Monthly flow distinguishes the annual salary rate from the calendar-year forecast. Displayed dollar totals use cents and percentages use one decimal place; stored inputs and calculations retain their precision.

### Company share price

With a stock grant or ESPP, every view shows one company share price on a slider. RSU vests and ESPP purchases and sales all use it. The reference mark is the newest grant's grant price (or, with ESPP only, the current offering's start price); the slider runs from a quarter of it to three times it. Until a price is saved, the app uses the price you entered on a grant or the ESPP, then the latest grant's price. **Reset** returns to that price, and the readout shows the change in annual compensation.

Starting balances, expenses, retirement timing, inflation and investment returns sit under Lifetime assumptions. Uploaded observations are preserved. Future deductions use the observed elections, subject to IRS and employer limits.

## Run

```sh
npm ci
npm start
npm test
```

Open http://127.0.0.1:5190. The server uses a fixed port and serves the app files listed in `site-files.js`. PDFs are parsed locally. Scanned PDFs require OCR and are not supported by this importer.

## Scenario as the source of truth

**Inspect scenario** shows the version 3 input document. **Export scenario** downloads it; importing the same file reproduces the calculations. Exports contain reviewed paycheck amounts, not raw PDF text, parser review metadata, undo snapshots or computed results.

Older `{config, events}` exports migrate on load. The original saved document is retained locally and can be downloaded from Inspect scenario. Life events are excluded with a notice. The original browser storage key is left intact. A new scenario key is written only after a successful edit or import.

Personal presets can be imported through the scenario importer. The app does not automatically populate new sessions from the ignored `development-defaults.js` file. Saved browser data is preserved.

## Deploying

The app is a static site hosted on Cloudflare Workers, set up like the home co-buy calculator. `npm run build` copies the files listed in `site-files.js` into `dist/`, along with pdf.js and the `_headers` security headers. `wrangler.jsonc` serves `dist/` as static assets, so no server code runs. Scenarios and paystubs stay in each visitor's browser. The build always writes an empty `development-defaults.js`, so a local personal preset is never published.

Browser storage belongs to one origin. The deployed site starts empty: export a scenario from http://127.0.0.1:5190 and import it there.

### One-time setup

In the Cloudflare dashboard, go to **Workers & Pages → Create application → Import a repository**, connect GitHub (choose **Only select repositories**), pick this repo, and set the **Production** build settings:

| Setting | Value |
| --- | --- |
| Project name | `net-worth-model` (must match `name` in `wrangler.jsonc`) |
| Root directory | `/` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

The site is served at https://net-worth-model.sidequestapps.workers.dev. For PR previews, add a **Preview builds** trigger for all branches except `main` with deploy command `npx wrangler versions upload`, as in the co-buy calculator.

### How updates ship

- Merging to `main` deploys production. Files are served with `max-age=0, must-revalidate`, so visitors get the new version on their next load.
- To roll back, open the Worker's **Deployments** tab and choose **Rollback** on an earlier version.
- `.github/workflows/ci.yml` runs tests and a build on every PR and push to `main`. Turn on branch protection for `main` and require the `test` check.

## Calculation path

| File | Responsibility |
| --- | --- |
| `scenario.js` | Input schema, validation, export and legacy migration |
| `profile.js` | Onboarding preview, schedule inference, follow-up questions and the share price range |
| `presentation.js` | Display text: notices, field badges, quick questions and estimate cards |
| `paystub-parser.js` | Reviewed observations and recurring election inference |
| `payroll-calendar.js` | Dated paychecks, YTD reconciliation and contribution caps |
| `equity-schedule.js` | RSU vest schedules and ESPP purchase pacing |
| `compensation.js` | Calendar aggregation, RSU/ESPP activity and cash flow |
| `tax-engine.js` | Tax rules, liability, attribution and payment reconciliation |
| `projection.js` | Annual asset growth, contributions, spending and drawdowns |
| `money-flow.js`, `compact-flow.js` | Accounting presentation and the compact Sankey |
| `app.js`, `tax-ui.js`, `grant-timeline.js` | Scenario editor, three result views and the grant timeline |
| `util.js`, `input-rules.js` | Shared helpers and editor field rules |

The app calculates one projection result after an input change. Monthly flow and Tax model read its first projected year. Lifetime projection reads the annual rows, beginning with an exact starting-balance snapshot. View changes do not rerun the financial model.

## Boundaries

- Payroll withholding and final tax liability are separate. The monthly ledger includes an evenly allocated planning settlement for their difference.
- Paychecks round to cents. Summing dated paychecks can differ from an unrounded annual withholding estimate.
- Lifetime returns are nominal; today's-dollar display deflates each year-end balance. Expenses inflate from the starting annual amount.
- Surplus cash remains cash. Drawdowns use cash, taxable investments, company equity, pre-tax retirement, then Roth. HSA and pending ESPP funding are reserved.
- Forced company-equity sales do not yet calculate new sale taxes or track individual cost-basis lots. Social Security uses the existing 85% taxable-income approximation. These are planning assumptions.
- The statutory engine currently supports single and married filing jointly, California, no state income tax, or a configured effective state rate. Future limits are projections.

Live stock quotes, life events and standalone ESPP/paycheck pages have been removed from this version. ESPP setup and paycheck reconciliation remain part of the core workflow.

See [Scenario format](SCENARIO.md), [Paystub import](PAYROLL_IMPORT.md) and [Tax rules](TAX_RULES.md).
