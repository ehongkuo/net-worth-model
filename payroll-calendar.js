(function (root) {
  "use strict";
  const cents = (v) => Math.round((Number(v) || 0) * 100);
  const amount = (v) => v / 100;
  const Util =
    typeof module !== "undefined" && module.exports
      ? require("./util")
      : root.Util;
  const { positive } = Util;
  const fields = [
    "salary",
    "bonus",
    "allowance",
    "taxableAllowance",
    "imputed",
    "traditional",
    "roth",
    "mega",
    "hsa",
    "health",
    "post",
    "espp",
    "employer",
    "hsaEmployer",
    "federal",
    "state",
    "ss",
    "medicare",
    "sdi",
    "local",
  ];
  const sum = (rows, key) =>
    amount(rows.reduce((n, p) => n + cents(p[key]), 0));
  function validDate(s) {
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(s || "") &&
      Number.isFinite(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s
    );
  }
  function splitCents(total, count) {
    if (!count) return [];
    const base = Math.trunc(total / count),
      extra = total - base * count;
    return Array.from(
      { length: count },
      (_, i) => base + (i < Math.abs(extra) ? Math.sign(extra) : 0),
    );
  }
  function distribute(rows, key, total) {
    splitCents(cents(total), rows.length).forEach(
      (v, i) => (rows[i][key] = amount(v)),
    );
  }
  function build(
    c,
    year,
    { dates, salary, bonus, limits: l, targets, employed = true },
  ) {
    const p = c.payroll || {},
      r = c.retirement,
      h = c.hsa,
      offset = year - c.taxYear;
    const parser =
      typeof module !== "undefined" && module.exports
        ? require("./paystub-parser")
        : root.PaystubParser;
    const baseline =
      p.uploadBaseline === false
        ? {}
        : parser.suggest(
            (p.records || []).filter((r) => Number(r.date.slice(0, 4)) <= year),
            c,
          );
    const benefitPlans = p.benefitPlans || parser.benefitPlans(p.records || []);
    const warnings = [...(baseline.warnings || [])],
      elections = p.elections || {};
    const rows = dates.map((date) => ({
      date,
      kind: "regular",
      source: "forecast",
      capEvents: [],
      ...Object.fromEntries(fields.map((k) => [k, 0])),
    }));
    distribute(rows, "salary", salary);
    if (bonus) {
      const row =
        rows.find((x) => x.date === p.bonusDate) ||
        rows.find((x) => Number(x.date.slice(5, 7)) === c.bonusMonth);
      if (row) row.bonus = bonus;
    }
    for (const key of [
      "traditional",
      "roth",
      "mega",
      "hsa",
      "employer",
      "hsaEmployer",
    ])
      distribute(rows, key, targets[key] || 0);
    distribute(rows, "health", targets.health || 0);
    distribute(rows, "post", targets.post || 0);
    for (const row of rows) {
      const observed = baseline.record && row.date > baseline.record.date;
      if (
        observed &&
        employed &&
        !p.manualFields?.includes("compensation.salary") &&
        baseline.record.current.salary != null
      )
        row.salary = amount(
          cents(
            baseline.record.current.salary *
              (1 + c.salaryGrowth) **
                Math.max(0, year - Number(baseline.record.date.slice(0, 4))),
          ),
        );
      row.elections = { ...elections, ...(observed ? baseline.elections : {}) };
      if (observed)
        for (const [key, e] of Object.entries(elections))
          if (
            e.manual ||
            (e.sourceDate &&
              e.sourceDate === baseline.elections?.[key]?.sourceDate)
          )
            row.elections[key] = e;
      for (const key of p.annualSettingKeys || []) delete row.elections[key];
      if (observed) row.withholdingBaseline = baseline.withholding;
      if (
        observed &&
        employed &&
        baseline.record.current.employer != null &&
        !p.manualFields?.some(
          (k) =>
            k.startsWith("employerPlan.retirement.employer") ||
            k.includes("match"),
        )
      )
        row.employer = amount(cents(baseline.record.current.employer));
      if (observed && employed && baseline.record.current.hsaEmployer != null)
        row.hsaEmployer = amount(cents(baseline.record.current.hsaEmployer));
      row.espp = targets.esppByDate?.[row.date] || 0;
      for (const [key, e] of Object.entries(row.elections)) {
        if (key === "espp" && targets.esppByDate?.[row.date] == null) continue;
        if (!fields.includes(key) || ["employer", "hsaEmployer"].includes(key))
          continue;
        const eligible =
          row.salary +
          ((["traditional", "roth", "mega"].includes(key) && r.bonusEligible) ||
          (key === "espp" && c.espp.bonusEligible)
            ? row.bonus
            : 0);
        row[key] = employed
          ? amount(
              cents(
                e.mode === "percent"
                  ? eligible * positive(e.value)
                  : positive(e.value),
              ),
            )
          : 0;
      }
      if (employed && (observed || p.ongoing)) {
        row.benefitDetails = [];
        const managed = new Set(
          benefitPlans
            .map((b) => parser.benefitTypes[b.category]?.field)
            .filter(
              (key) =>
                key &&
                !p.annualSettingKeys?.includes(key) &&
                !elections[key]?.manual,
            ),
        );
        for (const key of managed) row[key] = 0;
        for (const b of benefitPlans) {
          const key = parser.benefitTypes[b.category]?.field;
          if (!managed.has(key)) continue;
          const first = rows.find(
            (x) => x.date.slice(0, 7) === row.date.slice(0, 7),
          );
          const value =
            b.schedule === "once" || b.schedule === "review"
              ? 0
              : b.schedule === "monthly" && first !== row
                ? 0
                : positive(b.current);
          row[key] = (row[key] || 0) + value;
          row.benefitDetails.push({ ...b, value });
        }
      }
      if (!r.megaEnabled) row.mega = 0;
      if (!h.eligible) row.hsa = row.hsaEmployer = 0;
    }
    const records = (p.records || [])
      .filter((v) => validDate(v.date) && Number(v.date.slice(0, 4)) === year)
      .sort((a, b) => a.date.localeCompare(b.date));
    for (const record of records) {
      let row = rows.find(
        (x) =>
          x.date === record.date &&
          x.kind === record.kind &&
          x.source !== "uploaded",
      );
      if (!row && record.periodStart && record.periodEnd)
        row = rows
          .filter(
            (x) =>
              x.kind === record.kind &&
              x.source !== "uploaded" &&
              x.date >= record.periodStart &&
              x.date <= record.periodEnd,
          )
          .sort(
            (a, b) =>
              Math.abs(Date.parse(a.date) - Date.parse(record.date)) -
              Math.abs(Date.parse(b.date) - Date.parse(record.date)),
          )[0];
      if (row) row.date = record.date;
      if (!row) {
        row = {
          date: record.date,
          kind: record.kind || "regular",
          capEvents: [],
          ...Object.fromEntries(fields.map((k) => [k, 0])),
        };
        rows.push(row);
      }
      for (const key of fields) row[key] = Number(record.current[key]) || 0;
      row.benefitDetails = (record.benefits || []).map((b) => ({
        ...b,
        value: b.current || 0,
      }));
      row.source = "uploaded";
      row.recordId = record.id;
      row.reportedNet = record.netPay;
      row.taxableMedicare = record.current.taxableMedicare;
      row.taxableFederal = record.current.taxableFederal;
      row.taxablePayroll = record.current.taxablePayroll;
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const last = records.at(-1);
    if (last && p.useYtd !== false) {
      const history = rows.filter((x) => x.date <= last.date),
        missing = history.filter((x) => x.source !== "uploaded");
      for (const key of [
        ...fields,
        "taxablePayroll",
        "taxableFederal",
        "taxableMedicare",
      ]) {
        const snapshot = records.filter((r) => r.ytd?.[key] != null).at(-1);
        if (!snapshot) continue;
        const through = history.filter((x) => x.date <= snapshot.date);
        const residual =
          cents(snapshot.ytd[key]) -
          cents(
            sum(
              through.filter((x) => x.source === "uploaded"),
              key,
            ),
          );
        if (residual < 0) {
          warnings.push(
            `Uploaded ${key} exceeds the latest YTD snapshot; review the documents.`,
          );
          continue;
        }
        if (!missing.length && residual) {
          warnings.push(`No dated history available for ${key} YTD remainder.`);
          continue;
        }
        const eligibleHistory = missing.filter(
          (x) =>
            x.date <= snapshot.date &&
            (key !== "espp" || targets.esppByDate?.[x.date] != null),
        );
        if (eligibleHistory.length)
          distribute(eligibleHistory, key, amount(residual));
        else if (residual)
          warnings.push(
            `Unable to date ${key} YTD funding with the current enrollment schedule.`,
          );
      }
      missing.forEach((x) => (x.source = "history-estimate"));
      if (missing.length)
        warnings.push(
          "Earlier paycheck dates and amounts are estimates reconciled to the latest available YTD fields, not uploaded actuals.",
        );
      for (const key of ["employer", "hsaEmployer"]) {
        if (
          baseline.record?.current[key] != null &&
          (key === "hsaEmployer" ||
            !p.manualFields?.some(
              (k) =>
                k.startsWith("employerPlan.retirement.employer") ||
                k.includes("match"),
            ))
        )
          continue;
        const future = rows.filter(
          (x) => x.date > last.date && x.source === "forecast",
        );
        distribute(
          future,
          key,
          Math.max(0, (targets[key] || 0) - sum(history, key)),
        );
      }
    }
    const benefitUsed = {},
      monthUsed = {},
      planUsed = {};
    for (const category of ["fsa", "dependentCare"]) {
      const snapshots = records.flatMap((record) =>
        (record.benefits || [])
          .filter((b) => b.category === category && b.ytd != null)
          .map((b) => ({ ...b, date: record.date })),
      );
      const latestById = new Map();
      for (const b of snapshots) latestById.set(b.id, b);
      benefitUsed[category] = [...latestById.values()].reduce(
        (n, b) =>
          n +
          b.ytd +
          records
            .filter((rec) => rec.date > b.date)
            .reduce(
              (s, rec) =>
                s +
                (rec.benefits || [])
                  .filter((x) => x.id === b.id)
                  .reduce((s, x) => s + (x.current || 0), 0),
              0,
            ),
        0,
      );
    }
    for (const b of benefitPlans) {
      const latest = records
        .flatMap((rec) =>
          (rec.benefits || [])
            .filter((x) => x.id === b.id && x.ytd != null)
            .map((x) => ({ ...x, date: rec.date })),
        )
        .at(-1);
      planUsed[b.id] = latest
        ? latest.ytd +
          records
            .filter((rec) => rec.date > latest.date)
            .reduce(
              (n, rec) =>
                n +
                (rec.benefits || [])
                  .filter((x) => x.id === b.id)
                  .reduce((n, x) => n + (x.current || 0), 0),
              0,
            )
        : records.reduce(
            (n, rec) =>
              n +
              (rec.benefits || [])
                .filter((x) => x.id === b.id)
                .reduce((n, x) => n + (x.current || 0), 0),
            0,
          );
    }
    for (const row of rows)
      for (const b of row.benefitDetails || []) {
        const key = parser.benefitTypes[b.category]?.field,
          month = row.date.slice(0, 7) + b.category;
        const annual =
          b.category === "fsa"
            ? l.healthFsa
            : b.category === "dependentCare"
              ? Math.min(
                  l.dependentCare,
                  salary + bonus,
                  c.tax.filing === "married"
                    ? positive(c.tax.spouseIncome)
                    : Infinity,
                )
              : Infinity;
        const monthly = ["commuter", "parking"].includes(b.category)
          ? l.commuterMonthly
          : Infinity;
        if (row.source === "forecast") {
          const value = Math.min(
            b.value,
            Math.max(0, (b.annualCap ?? Infinity) - (planUsed[b.id] || 0)),
            Math.max(0, annual - (benefitUsed[b.category] || 0)),
            Math.max(0, monthly - (monthUsed[month] || 0)),
          );
          if (value < b.value) {
            row[key] -= b.value - value;
            row.capEvents.push(`${b.label}: limited to ${value.toFixed(2)}`);
          }
          b.value = value;
          planUsed[b.id] = (planUsed[b.id] || 0) + value;
          benefitUsed[b.category] = (benefitUsed[b.category] || 0) + value;
        }
        monthUsed[month] = (monthUsed[month] || 0) + b.value;
      }
    const age = c.age + offset,
      catchup =
        age >= 60 && age <= 63 ? l.superCatchup : age >= 50 ? l.catchup : 0;
    const prior = offset === 0;
    const annualCash = sum(rows, "salary") + sum(rows, "bonus");
    const statutory = Math.max(
      0,
      Math.min(annualCash, l.deferral + catchup) -
        (prior ? positive(r.priorDeferrals) : 0),
    );
    const requested = {
      ...Object.fromEntries(
        ["traditional", "roth", "mega", "hsa"].map((k) => [k, sum(rows, k)]),
      ),
    };
    const deferrals = Math.min(
      statutory,
      requested.traditional + requested.roth,
    );
    const employer = sum(rows, "employer");
    const planRoom = Math.max(
      0,
      Math.min(annualCash, l.total401k) -
        Math.min(
          l.deferral,
          deferrals + (prior ? positive(r.priorDeferrals) : 0),
        ) -
        employer -
        (prior ? positive(r.priorEmployer) + positive(r.priorAfterTax) : 0),
    );
    const megaCap =
      r.megaAnnualCap == null ? Infinity : positive(r.megaAnnualCap);
    const hsaLimit = h.eligible
      ? (((h.coverage === "family" ? l.hsaFamily : l.hsaSingle) +
          (age >= 55 ? l.hsaCatchup : 0)) *
          Math.min(12, positive(h.eligibleMonths))) /
        12
      : 0;
    const hsaRoom = Math.max(
      0,
      hsaLimit - sum(rows, "hsaEmployer") - (prior ? positive(h.prior) : 0),
    );
    const caps = {
      deferral: statutory,
      mega: Math.min(planRoom, megaCap),
      hsa: hsaRoom,
      espp: positive(c.espp.annualPayrollCap) || Infinity,
    };
    const used = { deferral: 0, mega: 0, hsa: 0, espp: 0 };
    let traditionalUsed = prior ? positive(r.priorDeferrals) : 0;
    for (const row of rows) {
      for (const key of ["traditional", "roth", "mega", "hsa", "espp"]) {
        const bucket = ["traditional", "roth"].includes(key) ? "deferral" : key,
          desired = cents(row[key]);
        const remaining = Math.max(0, cents(caps[bucket]) - used[bucket]);
        if (row.source === "forecast") {
          row[key] = amount(Math.min(desired, remaining));
          if (desired > remaining)
            row.capEvents.push(
              `${key}: ${amount(remaining).toFixed(2)} remaining before the cap`,
            );
        } else if (desired > remaining)
          warnings.push(
            `Recorded ${key} exceeds the available cap on ${row.date}; actuals were preserved.`,
          );
        used[bucket] += cents(row[key]);
      }
      if (
        row.source === "forecast" &&
        catchup &&
        positive(r.priorYearWages) > l.rothCatchupThreshold
      ) {
        const move = Math.max(
          0,
          row.traditional - Math.max(0, l.deferral - traditionalUsed),
        );
        row.traditional -= move;
        row.roth += move;
        if (move)
          row.capEvents.push(
            "Catch-up routed to Roth based on prior-year wages",
          );
      }
      traditionalUsed += row.traditional;
      row.remaining = {
        deferral: amount(Math.max(0, cents(caps.deferral) - used.deferral)),
        mega: amount(Math.max(0, cents(caps.mega) - used.mega)),
        hsa: amount(Math.max(0, cents(caps.hsa) - used.hsa)),
      };
    }
    const totals = Object.fromEntries(fields.map((k) => [k, sum(rows, k)]));
    return {
      rows,
      totals,
      caps,
      requested,
      warnings,
      baseline,
      historyThrough: last && p.useYtd !== false ? last.date : null,
    };
  }
  function withholding(
    schedule,
    c,
    year,
    taxEngine,
    equity = { rsuVests: [] },
  ) {
    const l = taxEngine.limits(year, c.tax),
      rows = schedule.rows,
      n = rows.filter((x) => x.kind === "regular").length || 1;
    let wages = 0,
      medicareWages = 0,
      supplemental = 0;
    const snapshots = (
      c.payroll?.useYtd === false ? [] : c.payroll?.records || []
    )
      .filter((r) => Number(r.date.slice(0, 4)) === year)
      .sort((a, b) => a.date.localeCompare(b.date));
    const ssThrough =
        snapshots.filter((r) => r.ytd?.taxablePayroll != null).at(-1)?.date ||
        "",
      medicareThrough =
        snapshots
          .filter(
            (r) =>
              r.ytd?.taxableMedicare != null || r.ytd?.taxablePayroll != null,
          )
          .at(-1)?.date || "";
    schedule.equityTaxes = [];
    const supplementalTax = (value, rate) => {
      const excess =
        Math.max(0, supplemental + value - 1000000) -
        Math.max(0, supplemental - 1000000);
      supplemental += value;
      return (value - excess) * rate + excess * 0.37;
    };
    const events = [
      ...rows.map((row) => ({ date: row.date, row })),
      ...(equity.rsuVests || []).map((vest) => ({ date: vest.date, vest })),
    ].sort((a, b) => a.date.localeCompare(b.date));
    for (const event of events) {
      if (event.vest) {
        const v = event.vest,
          value = v.value;
        const ss =
          0.062 *
          (Math.min(l.ssBase, wages + value) - Math.min(l.ssBase, wages));
        const medicare =
          value * 0.0145 +
          0.009 *
            (Math.max(0, medicareWages + value - 200000) -
              Math.max(0, medicareWages - 200000));
        const federal = supplementalTax(value, c.tax.rsuFederalRate),
          local = Math.max(0, Number(c.tax.localRate) || 0),
          state =
            (c.tax.state === "none" ? 0 : value * c.tax.rsuStateRate) +
            value * local,
          sdi = c.tax.state === "CA" ? value * c.tax.caSdi : 0;
        schedule.equityTaxes.push({
          date: v.date,
          value,
          federal,
          state,
          ss,
          medicare,
          sdi,
        });
        if (event.date > ssThrough) wages += value;
        if (event.date > medicareThrough) medicareWages += value;
        continue;
      }
      const row = event.row;
      const payrollBase = Math.max(
        0,
        row.salary +
          row.bonus +
          row.taxableAllowance +
          row.imputed -
          row.health -
          (c.hsa.payroll ? row.hsa : 0),
      );
      const federalBase = Math.max(0, payrollBase - row.traditional);
      if (row.source === "forecast") {
        row.taxablePayroll = payrollBase;
        row.taxableFederal = federalBase;
        row.ss = amount(
          cents(
            0.062 *
              (Math.min(l.ssBase, wages + payrollBase) -
                Math.min(l.ssBase, wages)),
          ),
        );
        row.medicare = amount(
          cents(
            0.0145 * payrollBase +
              0.009 *
                (Math.max(0, medicareWages + payrollBase - 200000) -
                  Math.max(0, medicareWages - 200000)),
          ),
        );
        row.sdi =
          c.tax.state === "CA"
            ? amount(
                cents(
                  Math.max(
                    0,
                    row.salary +
                      row.bonus +
                      row.taxableAllowance +
                      row.imputed -
                      row.health,
                  ) * c.tax.caSdi,
                ),
              )
            : 0;
        const regularFederal = Math.max(
          0,
          row.salary +
            row.taxableAllowance +
            row.imputed -
            row.health -
            (c.hsa.payroll ? row.hsa : 0) -
            row.traditional *
              (row.salary /
                Math.max(
                  1,
                  row.salary + (c.retirement.bonusEligible ? row.bonus : 0),
                )),
        );
        const hypothetical = taxEngine.calculate(
          {
            wages: (row.salary + row.taxableAllowance + row.imputed) * n,
            pretax: row.traditional * n,
            payrollDeduction: row.health * n,
            hsa: row.hsa * n,
            hsaPayroll: c.hsa.payroll ? row.hsa * n : 0,
            employerHsa: row.hsaEmployer * n,
          },
          year,
          c.tax,
        );
        row.federal = amount(
          cents(
            (c.tax.salaryFederalRate == null
              ? taxEngine.federalWithholding(regularFederal * n, year, c.tax) /
                n
              : regularFederal * c.tax.salaryFederalRate) +
              supplementalTax(
                Math.max(0, federalBase - regularFederal),
                c.tax.bonusFederalRate,
              ) +
              c.tax.federalExtra,
          ),
        );
        row.local = 0;
        row.state =
          c.tax.state === "none" && !c.tax.localRate
            ? 0
            : amount(
                cents(
                  (c.tax.salaryStateRate == null
                    ? hypothetical.state / n
                    : Math.max(
                        0,
                        row.salary -
                          row.traditional -
                          row.health -
                          (c.tax.state === "CA" ? 0 : row.hsa),
                      ) *
                      (c.tax.salaryStateRate +
                        Math.max(0, Number(c.tax.localRate) || 0))) +
                    row.bonus *
                      ((c.tax.state === "none" ? 0 : c.tax.bonusStateRate) +
                        Math.max(0, Number(c.tax.localRate) || 0)) +
                    c.tax.stateExtra,
                ),
              );
      }
      if (row.source === "forecast" && row.withholdingBaseline) {
        const observed = row.withholdingBaseline;
        if (observed.federal)
          row.federal = amount(
            cents(row.taxableFederal * observed.federal.rate),
          );
        if (observed.state) row.local = 0;
        if (observed.state)
          row.state = amount(
            cents((row.salary + row.bonus) * observed.state.rate),
          );
      }
      if (row.source !== "forecast") supplemental += row.bonus;
      wages += row.taxablePayroll ?? payrollBase;
      medicareWages += row.taxableMedicare ?? row.taxablePayroll ?? payrollBase;
      row.grossCash =
        row.salary + row.bonus + row.allowance + row.taxableAllowance;
      row.withholding = amount(
        cents(
          row.federal + row.state + row.local + row.ss + row.medicare + row.sdi,
        ),
      );
      row.netPay = amount(
        cents(
          row.grossCash -
            row.traditional -
            row.roth -
            row.mega -
            (c.hsa.payroll ? row.hsa : 0) -
            row.health -
            row.post -
            row.espp -
            row.withholding,
        ),
      );
    }
    return schedule;
  }
  const api = { build, withholding, splitCents, validDate, sum, fields };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PayrollCalendar = api;
})(typeof window !== "undefined" ? window : globalThis);
