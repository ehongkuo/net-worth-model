# Lifetime Net Worth Projection

Interactive web app that projects net worth from age 25 to 100, calibrated to real compensation and spending data, with an accumulation phase, a retirement phase, and customizable life events.

## Features

- **3 chart views**: total net worth, account breakdown (stacked area), income vs expenses
- **Nominal / today's-dollars toggle**: view every figure in future dollars or discounted back to age-25 purchasing power
- **Accumulation + retirement**: employment income and contributions run until a configurable retirement age, then spending is funded by Social Security plus a tax-aware drawdown of your accounts
- **Customizable life events**: 12 templates plus custom events with a full effects editor
  - Career: promotions (relative raises), job changes, layoffs, sabbaticals
  - Housing: home purchase / sale with mortgage amortization
  - Family: marriage, children
  - Market: bull / bear market periods
  - Windfalls: inheritance, large gifts
- **Interactive assumptions**: inflation, market return, salary growth, real-estate appreciation, retirement age, Social Security
- **Progressive tax modeling**: federal + California brackets with standard deductions, FICA on wages, all inflation-adjusted
- **Save / export / import**: scenarios persist in the browser and can be exported to (or imported from) a JSON file
- **Year-by-year data table**: expandable, with event highlighting

## Compensation and monthly cash flow

The sidebar separates tax and long-term assumptions from compensation, contribution and living-expense inputs. The Monthly Cash Flow tab reconciles pay, stock sales, benefits, savings and taxes. The ESPP tab shares those inputs with the projection.

RSUs are entered as total grant value over a number of years, with a cliff and vesting frequency. Federal limits default to published 2026 values. Future Limits shows adjustable projections and per-year overrides. California income tax is explicitly projected from published 2025 tables.

See [Tax rules and calculation boundaries](TAX_RULES.md) for sources, cash-timing conventions and known limitations. The browser uses this compensation engine; the older annual engine remains available to programmatic callers without a compensation configuration.

## Usage

With Node.js 20 or later, run `npm start` and open [http://127.0.0.1:5190](http://127.0.0.1:5190). No build step is required. Run `npm test` for the calculation and local-server tests.

Monthly Cash Flow shows gross cash pay minus withholding and payroll deductions as take-home cash. The Sankey follows that cash into spending, additional tax reserves, asset contributions and remaining cash. Held RSUs, ESPP purchase benefits and employer contributions enter as asset value and reach the account destinations on the right. Proceeds and refunds recycle ESPP principal without counting it as new income. Expand the flow table for exact monthly amounts.

### Stock prices

Create a free [Twelve Data account](https://twelvedata.com/pricing), then enter its API key in the Stock prices tab. The local server keeps the key in memory until disconnected or restarted; it is not saved in scenarios. The Basic plan allows 8 credits per minute and 800 per day, subject to provider coverage.

Add a ticker to an RSU grant or ESPP. Its quote loads automatically beside the input, with the company, timestamp and current model estimate. Select Use as estimate to update that valuation. Quotes are cached for five minutes; errors appear beside the ticker with a Retry action. Applying a quote preserves historical grant sizing and the ESPP offering price. Manual prices remain available, and a current quote does not predict future returns.

## How the model works

Each year the engine, in order: applies life events and any retirement transition, computes income by tax treatment, grows balances and adds contributions, then solves that year's taxes and any retirement withdrawal together before recording a net-worth snapshot.

### Legacy annual engine

The following describes the original programmatic path. Browser scenarios use the compensation engine described in [TAX_RULES.md](TAX_RULES.md).

### Taxes

- **Federal**: 2025 progressive brackets on income above the standard deduction ($15k single / $30k married), inflation-adjusted.
- **California**: full FTB progressive brackets above the CA standard deduction.
- **FICA**: Social Security (per-earner wage-base cap) + Medicare + additional Medicare, levied on **gross wages only**. Traditional 401(k) contributions do not reduce FICA. Qualifying payroll HSA contributions reduce federal FICA wages; direct HSA contributions do not. In the legacy calculation path, HSA contributions are treated as direct contributions; rental income, Social Security, and windfalls are not subject to it.
- **Income by treatment**: wages (income tax + FICA), ordinary non-wage income (income tax only), and tax-free income (inheritance, gift, home-sale equity).

### Retirement

At the retirement age, wages and contributions stop. Social Security (entered in today's dollars) starts at its own age, is inflated to nominal, is FICA-exempt, and is 85% federally taxable / untaxed by CA. When income no longer covers spending, funds are drawn from the cash buffer, then taxable brokerage, then pre-tax accounts (401k / traditional IRA), then Roth, then HSA. Pre-tax withdrawals are ordinary income, so taxes and the required withdrawal are solved together as a fixed point.

### Known simplifications

- No required minimum distributions (RMDs).
- Investment growth ignores dividend / capital-gains tax drag in both phases; brokerage withdrawals are untaxed.
- California is the only modeled state; Social Security taxation uses a flat 85% inclusion rather than the provisional-income formula.

## Architecture

| File | Purpose |
|:---|:---|
| `compensation.js` | Shared compensation, payroll, tax and ESPP calculations |
| `compensation-ui.js` | Sidebar inputs, cash-flow tables and projected limits |
| `model.js` | Simulation engine (LifetimeModel, event system, tax tables, retirement drawdown) |
| `app.js` | UI controller (Chart.js, event modal, sliders, cards, persistence) |
| `style.css` | Dark glassmorphism theme |
| `index.html` | Page structure |
| `test/` | Zero-dependency Node test suite |

## Tests

```bash
npm test    # runs test/run.js under Node, no dependencies to install
```

Covers the tax engine, retirement and drawdown, event mechanics, inflation adjustment, and per-year money conservation.

## Tech Stack

- Vanilla HTML/CSS/JS
- [Chart.js v4](https://www.chartjs.org/) (CDN)
- [Inter font](https://fonts.google.com/specimen/Inter) (Google Fonts)

🤖 Generated with Codex

Monthly Cash Flow always uses the starting tax year. The projection slider only changes the lifetime projection. Calculation fixtures and their independent derivations live in `test/expected-cash-flow.test.js`.

## Taxes view

The Taxes tab explains the annual tax calculation used by monthly cash flow and the lifetime projection: income sources, deductions, ordinary and capital-gains brackets, contribution effects, payroll taxes, withholding and remaining liability. Expand bracket rows to inspect their arithmetic. Federal rules use the published 2026 baseline; California and later-year estimates are labeled.

ESPP settings are employer-neutral. Held-share future-tax reserves are optional cash earmarks; actual sales feed current liability once. See [TAX_RULES.md](TAX_RULES.md) for supported cases, assumptions and source links.

Monthly Cash Flow can switch between an explicitly amortized monthly average and the current calendar month when it matches the scenario tax year. The current-month view follows scheduled pay, vesting and ESPP transactions. Annual tax settlements and reserves remain monthly planning allocations. The Taxes tab compares gross income and income after pre-tax contributions and benefits. Household deductions and the resulting taxable income appear separately below the bars, followed by tax calculations and cash/equity outcomes.

The Sankey has six stages: sources, total incoming value, pre-tax deductions, tax payments, cash/assets, and illustrative cost allocation. Costs use current-period cash, then ESPP, RSUs and retirement value. This is a visual allocation only: it never sells holdings, withdraws account balances or changes the projection. Unfunded costs and the actual cash shortfall stay visible. HSA assets and earmarked future-tax cash are excluded from general expense allocation.

The monthly overview leads with spendable cash, living expenses and cash surplus or shortfall. A separate account breakdown shows retirement, HSA and retained equity additions. Sankey ribbons use category colors: cash and bonus, equity, retirement/HSA, and taxes/costs. Filled curves and centered columns keep joins smooth. Salary timing explains annual salary divided by 12 versus paychecks scheduled in the current month.

For local development, an optional `development-defaults.js` defines `window.DEVELOPMENT_SCENARIO` as an exported `{config, events}` scenario. It is excluded from Git. New browser origins and Reset use this preset; existing saved scenarios take precedence. Without a preset, the built-in configurable defaults apply. The local server serves an empty optional script when the file is absent.

Payday anchor accepts any known payday for weekly or biweekly schedules. The same cadence is extended backward and forward from that date. Monthly and semimonthly schedules retain their calendar-based behavior.

The local preview defaults to port 5190. Running `npm start` again reuses the preview only when that port serves this checkout. It does not choose another port automatically. Refresh the page after frontend edits; server edits require a restart.

ESPP offerings end the day before the next offering by default. An explicit end date also becomes the purchase date, with per-offering overrides available. Payroll funds remain cash until purchase. For qualified Section 423 plans, held shares have no purchase-time income tax; sale taxes follow the ordinary-income and capital-gain rules described in [IRS Publication 525](https://www.irs.gov/publications/p525).

## Upload-driven forecasts and flow details

The latest reviewed regular paycheck supplies future pay and recurring deductions. Percentage elections follow eligible pay; fixed deductions repeat per paycheck. Uploaded actuals stay intact, and YTD totals reduce remaining annual capacity. A capped paycheck retains an earlier uncapped election or the configured election. Without either, the app keeps annual settings and displays a warning.

Future federal withholding uses the uploaded federal taxable-wage rate. State withholding uses the uploaded amount relative to gross salary and bonus because the importer does not currently extract a state taxable-wage basis. Payroll taxes still follow statutory rules. The tax engine calculates annual liability separately from these projected payments.

Click a Sankey base or ribbon for a Component / Based on / Rate / Amount table. Expanded details include individual paycheck elections, applied limits and pricing assumptions. Effective rates describe the displayed period; elections can differ when a limit is reached. Pending ESPP valuation is a visual estimate and does not change purchase timing or account balances.
