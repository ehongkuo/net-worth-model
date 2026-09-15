# Project guidance

## Configurable financial model

This app is used for detailed personal financial projections and must also work for people with different compensation, benefits, employment histories, tax profiles, assets, and goals.

- During development, use the owner's supplied values and plan choices as editable scenario defaults. Keep them in configuration or named presets, separate from calculation and rendering logic.
- Do not hard-code personal amounts, employers, tickers, dates, enrollment choices, or contribution elections into the engine. Do not infer participation from another user's circumstances.
- Keep statutory rules in documented, tax-year-specific rule tables. Keep employer-specific rules in configurable plan profiles. Distinguish legal limits from user assumptions and employer restrictions.
- Configuration need not mean a visible input for every rule. Use sensible presets and progressive disclosure; expose overrides where they affect meaningful choices or accuracy.
- Model employment eligibility and actual participation separately. For ESPP, track enrollment by offering and account for skipped offerings, differing schedules, and plan-specific re-enrollment behavior.
- Preserve saved user inputs when changing defaults or migrating scenarios. Test with synthetic scenarios on an isolated browser origin, never by changing the owner's saved scenario.
- Write independent expected-value tests before comparing engine or UI outputs. Cover materially different users and plan choices, including zeros, partial-year participation, limits, and boundary dates.
- Consider portability with every change: a different user must be able to use the feature through configuration, without changing source code.
