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

## Usage

Open `index.html` in a browser. No build step or server required.

## How the model works

Each year the engine, in order: applies life events and any retirement transition, computes income by tax treatment, grows balances and adds contributions, then solves that year's taxes and any retirement withdrawal together before recording a net-worth snapshot.

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
</content>
