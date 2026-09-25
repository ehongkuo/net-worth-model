# Scenario format, version 3

The scenario stores independent inputs. Every financial view is derived from it.

| Group | Contents |
| --- | --- |
| `taxProfile` | Starting tax year, age, optional birthday metadata, filing/state settings, deductions, credits, withholding assumptions and future rule growth |
| `employerPlan` | Retirement/HSA funding, employer limits, benefit deductions and ESPP terms/enrollment overrides |
| `compensation` | Salary, growth, bonus, pay frequency/anchor, stock growth and RSU grant schedules |
| `uploads` | Reviewed current/YTD paycheck observations, inferred or edited elections, optional bonus date and baseline controls |
| `projection` | Horizon, retirement timing, inflation, investment return, Social Security, starting balances and monthly expenses |

`Scenario.normalize` fills missing defaults, accepts known fields and rejects invalid dates, numeric inputs, versions and horizons. `Scenario.serialize` produces the canonical JSON export. `Scenario.engineInput` is a transient adapter for the calculation modules, never a second saved configuration.

Each uploaded record contains its ID, check date, kind, pay-period dates, current amounts, YTD amounts and net pay. Election records contain mode (`percent` or `fixed`), value and source date. They do not contain the original PDF, employee identity, account details or extracted text.

The calendar reconciles actual observations and YTD, infers recurring elections from the newest regular upload, applies employer restrictions and IRS limits, then produces dated payroll rows. Compensation aggregates those rows with scheduled equity activity. The tax engine computes annual liability and distinguishes it from amounts already withheld. The projection adds balance growth, expenses and any withdrawal tax.

The Sankey's pending-ESPP valuation is an illustration of the configured purchase benefit. The ledger continues to classify unpurchased shares as pending cash. This presentation does not create a second financial balance.

Exports preserve configurable tax overrides and offering-specific ESPP enrollment settings. The simplified editor exposes common inputs; advanced settings remain portable through JSON. Age is the configured age at projection start; birthday is preserved as metadata during migration.

Legacy exports migrate through a single boundary. Obsolete runtime flags, life events and cached results are excluded. The browser keeps the original export as a separate downloadable backup and leaves the legacy storage entry untouched.


Uploads may include `benefits` records with `id`, `label`, `category`, `current`,
`ytd`, `schedule` and `annualCap`. These optional version-3 fields preserve reviewed
inputs through export/import. Aggregated payroll amounts remain available for
legacy scenarios. Ongoing results and calendar results are derived separately by
the shared engine and are never persisted as inputs.

## Current earning pace and dated equity

The default monthly view uses the current salary rate and recurring elections,
subject to annual contribution limits. RSUs use the active grant year's allocation
divided by its duration, revalued at the configured share price. A cliff delays
vesting but does not suppress that earning rate. The rate becomes zero on the
final vest date. Future grants are excluded until their start date; annual repeat
grants remain an explicit option.

Grants accept `evenVesting` and `annualAllocations` (percentages totaling 100).
Missing `evenVesting` means an even schedule. Each vest is assigned wholly to its
calendar quarter. The five-year timeline shows the previous calendar year and the
current year through three years ahead. Exact dates still determine vest events.

ESPP earning pace repeats the active offering's assumptions, divides its cost,
market value and refunds by the cycle length, and shares qualified annual share
capacity across recurring cycles. It does not extrapolate a partial cycle or add
opening deposits to new earnings. This is a normalized rate, not a guarantee that
the next twelve months will match it. Selected months and lifetime projections
continue to use dated payroll and equity events. The existing selected-month
pending-ESPP preview remains an explicitly hypothetical valuation, separate from
the ledger's pending cash balance.
