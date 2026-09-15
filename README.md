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

With Node.js 20 or later, run `npm start` and open http://127.0.0.1:5182. No build step is required. Run `npm test` for the calculation and local-server tests.

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
- **FICA**: Social Security (per-earner wage-base cap) + Medicare + additional Medicare, levied on **gross wages only**. 401k/HSA do not reduce FICA; rental income, Social Security, and windfalls are not subject to it.
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
