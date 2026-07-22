# Lifetime Net Worth Projection

Interactive web app that projects net worth growth over a lifetime (age 25 → 100), calibrated to real compensation and spending data.

## Features

- **3 chart views**: Total net worth, account breakdown (stacked area), income vs expenses
- **Customizable life events**: 12 pre-built templates + custom events with full effects editor
  - Career: promotions, job changes, layoffs, sabbaticals
  - Housing: home purchase/sale with mortgage amortization
  - Family: marriage, children
  - Market: bull/bear market periods
  - Windfalls: inheritance, large gifts
- **Interactive assumptions**: Inflation, market return, salary growth, real estate appreciation
- **Progressive tax modeling**: Federal brackets + CA state + FICA, inflation-adjusted
- **Year-by-year data table**: Expandable with event highlighting

## Usage

Open `index.html` in a browser. No build step or server required.

## Architecture

| File | Purpose |
|:---|:---|
| `model.js` | Simulation engine (LifetimeModel class, event system, tax calculations) |
| `app.js` | UI controller (Chart.js, event modal, sliders, summary cards) |
| `style.css` | Dark glassmorphism theme |
| `index.html` | Page structure |

## Tech Stack

- Vanilla HTML/CSS/JS
- [Chart.js v4](https://www.chartjs.org/) (CDN)
- [Inter font](https://fonts.google.com/specimen/Inter) (Google Fonts)
