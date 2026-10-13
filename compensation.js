(function (root) {
  "use strict";
  const EquitySchedule =
    typeof module !== "undefined" && module.exports
      ? require("./equity-schedule")
      : root.EquitySchedule;
  const TaxEngine =
    typeof module !== "undefined" && module.exports
      ? require("./tax-engine")
      : root.TaxEngine;

  const PayrollCalendar =
    typeof module !== "undefined" && module.exports
      ? require("./payroll-calendar")
      : root.PayrollCalendar;
  const Util =
    typeof module !== "undefined" && module.exports
      ? require("./util")
      : root.Util;
  const {
    positive,
    clamp,
    addMonths,
    merge,
    isoDate: iso,
    utcDate: date,
  } = Util;
  const sum = (rows, key) => rows.reduce((n, r) => n + (r[key] || 0), 0);
  const endMonth = (y, m) => iso(new Date(Date.UTC(y, m + 1, 0, 12)));
  function defaults() {
    return {
      version: 2,
      taxYear: 2026,
      age: 25,
      salary: 165000,
      salaryGrowth: 0.03,
      bonusPercent: 0,
      bonusMonth: 3,
      frequency: "biweekly",
      firstPayday: "2026-01-09",
      stockGrowth: 0,
      grants: [],
      tax: TaxEngine.defaults(),
      retirement: {
        traditional: 0,
        roth: 0,
        mega: 0,
        megaEnabled: false,
        employerAnnual: 0,
        matchRate: 1,
        matchPercent: 0,
        matchTrueUp: true,
        bonusEligible: true,
        rsuEligible: false,
        contributionGrowth: 0.025,
        priorDeferrals: 0,
        priorEmployer: 0,
        priorAfterTax: 0,
        ira: 0,
        iraMode: "roth",
        iraPretaxBalance: 0,
        iraBasis: 0,
        conversionDelayMonths: 0,
        priorYearWages: 0,
      },
      hsa: {
        eligible: true,
        coverage: "single",
        employee: 0,
        employer: 0,
        payroll: true,
        eligibleMonths: 12,
        prior: 0,
      },
      benefits: {
        health: 0,
        dental: 0,
        vision: 0,
        fsa: 0,
        otherPretax: 0,
        otherPosttax: 0,
      },
      espp: {
        enabled: false,
        qualifiedPlan: true,
        rate: 0.15,
        bonusEligible: false,
        discount: 0.15,
        lookback: true,
        offerPrice: 100,
        purchasePrice: 100,
        salePrice: 100,
        periodMonths: 6,
        start: "2026-01-01",
        holdMonths: 0,
        shareCap: 0,
        annualFmvLimit: 25000,
        fractional: false,
        fee: 0,
      },
      payroll: { enabled: true, useYtd: true, elections: {}, records: [] },
      forecastFromMonth: 1,
    };
  }

  const limits = TaxEngine.limits;
  const tax = TaxEngine.calculate;
  const paydayCache = new Map();
  function paydays(c, year) {
    const key = `${c.frequency}:${c.firstPayday}:${year}`;
    if (paydayCache.has(key)) return paydayCache.get(key);
    const days = [];
    if (c.frequency === "biweekly" || c.frequency === "weekly") {
      const d = date(c.firstPayday),
        step = c.frequency === "weekly" ? 7 : 14;
      if (!Number.isFinite(d.getTime()))
        throw new Error("Enter a valid payday anchor.");
      const start = date(`${year}-01-01`);
      d.setUTCDate(
        d.getUTCDate() + Math.ceil((start - d) / 86400000 / step) * step,
      );
      while (d.getUTCFullYear() === year) {
        days.push(iso(d));
        d.setUTCDate(d.getUTCDate() + step);
      }
    } else {
      for (let m = 0; m < 12; m++) {
        if (c.frequency === "semimonthly")
          days.push(`${year}-${String(m + 1).padStart(2, "0")}-15`);
        days.push(endMonth(year, m));
      }
    }
    paydayCache.set(key, days);
    return days;
  }
  // Tax treatment of selling one ESPP lot.
  // Section 423 plan: a qualifying disposition (>2y from offering and >1y from purchase)
  // has ordinary income equal to the lesser of the offering-date discount and the
  // actual gain; a disqualifying one has ordinary income equal to the purchase-date
  // spread, even at a loss. Non-qualified plan: the spread was taxed as wages at
  // purchase, so basis is purchase-date FMV and the sale has no ordinary income.
  // Both are measured on the gross sale value; the fee only reduces the capital gain.
  function sellLot(lot, saleDate, price, fee = 0, qualifiedPlan = true) {
    const gross = lot.shares * price,
      proceeds = Math.max(0, gross - fee);
    const qualified =
      qualifiedPlan &&
      saleDate > addMonths(lot.grantDate, 24) &&
      saleDate > addMonths(lot.purchaseDate, 12);
    const spread =
      lot.shares *
      Math.max(0, lot.purchasePrice - lot.cost / Math.max(lot.shares, 1e-20));
    const ordinary = !qualifiedPlan
      ? 0
      : qualified
        ? Math.max(
            0,
            Math.min(
              lot.shares * lot.grantPrice * lot.discount,
              gross - lot.cost,
            ),
          )
        : spread;
    const gain = qualifiedPlan
      ? proceeds - lot.cost - ordinary
      : proceeds - lot.cost - spread;
    const longTerm = saleDate > addMonths(lot.purchaseDate, 12);
    return {
      proceeds,
      ordinary,
      gain,
      longGain: longTerm ? gain : 0,
      shortGain: longTerm ? 0 : gain,
      qualified,
    };
  }
  const rsuMode = (g) =>
    g.saleMode ||
    (g.sell === true ? "sell" : g.sell === false ? "hold" : "cover");
  function offeringDates(e, grantDate) {
    const next = addMonths(grantDate, Math.max(1, Math.round(e.periodMonths)));
    const offset =
      (Number(grantDate.slice(0, 4)) -
        Number((e.start || grantDate).slice(0, 4))) *
        12 +
      Number(grantDate.slice(5, 7)) -
      Number((e.start || grantDate).slice(5, 7));
    const endDate =
      e.enrollments?.[grantDate]?.end ||
      (e.end
        ? addMonths(e.end, offset)
        : iso(new Date(date(next).getTime() - 86400000)));
    const purchaseDate = e.enrollments?.[grantDate]?.purchaseDate || endDate;
    return { next, endDate, purchaseDate };
  }
  function equity(c, year, salary, bonus, options = {}) {
    const months = Array.from({ length: 12 }, () => ({
      rsu: 0,
      rsuCash: 0,
      rsuCoverEligible: 0,
      esppContrib: 0,
      esppSalaryContrib: 0,
      esppProceeds: 0,
      esppRefund: 0,
      ordinary: 0,
      shortGain: 0,
      longGain: 0,
    }));
    let stockAssets = 0,
      openingAssets = 0;
    const payrollDeductions = {},
      lots = [],
      rsuVests = [],
      offerings = [],
      e = c.espp,
      baseYear = c.taxYear;
    const stockFactor = (y) => (1 + c.stockGrowth) ** Math.max(0, y - baseYear);
    const grants = c.grants.flatMap((g, grantIndex) =>
      g.repeat
        ? Array.from(
            { length: Math.max(0, year - Number(g.start.slice(0, 4)) + 1) },
            (_, i) => ({ ...g, grantIndex, start: addMonths(g.start, 12 * i) }),
          )
        : [{ ...g, grantIndex }],
    );
    for (const grant of grants) {
      const length = Math.max(1, Math.round(grant.months || 48));
      const interval = Math.max(1, Math.round(grant.interval || 3));
      const cliff = clamp(grant.cliff, 0, length);
      const start = grant.start || `${baseYear}-01-01`;
      let vested = 0;
      for (let elapsed = 1; elapsed <= length; elapsed++) {
        if (
          elapsed < cliff ||
          (elapsed % interval !== 0 && elapsed !== cliff && elapsed !== length)
        )
          continue;
        const vestDate = addMonths(start, elapsed);
        const vestYear = Number(vestDate.slice(0, 4));
        const value =
          ((positive(grant.value) *
            (EquitySchedule.cumulative(grant, elapsed) -
              EquitySchedule.cumulative(grant, vested)) *
            (positive(grant.vestPrice) || positive(grant.grantPrice) || 100)) /
            (positive(grant.grantPrice) || 100)) *
          stockFactor(vestYear);
        const vestShares =
          (positive(grant.value) *
            (EquitySchedule.cumulative(grant, elapsed) -
              EquitySchedule.cumulative(grant, vested))) /
          (positive(grant.grantPrice) || 100);
        vested = elapsed;
        if (
          vestYear < baseYear ||
          vestYear > year ||
          (options.stopYear && vestYear >= options.stopYear) ||
          options.history?.[vestYear]?.employed === false ||
          (vestYear === year && options.employed === false)
        )
          continue;
        if (rsuMode(grant) !== "sell") {
          stockAssets += (value / stockFactor(vestYear)) * stockFactor(year);
          if (vestYear < year)
            openingAssets +=
              (value / stockFactor(vestYear)) * stockFactor(year - 1);
        }
        if (vestYear === year && options.employed !== false) {
          const m = months[Number(vestDate.slice(5, 7)) - 1];
          m.rsu += value;
          if (rsuMode(grant) === "sell") m.rsuCash += value;
          if (rsuMode(grant) === "cover") m.rsuCoverEligible += value;
          rsuVests.push({
            grantIndex: grant.grantIndex,
            name: grant.name || "RSU grant",
            date: vestDate,
            shares: vestShares,
            value,
            mode: rsuMode(grant),
          });
        }
      }
    }
    if (options.earningEspp) {
      const original = options.earningEspp;
      const pace = options.payrollSchedule
        ? EquitySchedule.esppPace(
            c,
            options.earningDate,
            PayrollCalendar.sum(options.payrollSchedule.rows, "espp"),
          )
        : original;
      if (pace.active) {
        const dates = paydays(c, year),
          deductions = PayrollCalendar.splitCents(
            Math.round(pace.monthlyContribution * 1200),
            dates.length,
          );
        dates.forEach((d, i) => (payrollDeductions[d] = deductions[i] / 100));
        const purchaseDate = `${year}-12-31`,
          grantDate = addMonths(purchaseDate, -pace.periodMonths),
          saleDate = addMonths(purchaseDate, positive(e.holdMonths));
        const lot = {
          grantDate,
          purchaseDate,
          shares: pace.monthlyShares * 12,
          cost: pace.monthlyCost * 12,
          grantPrice: pace.grantPrice,
          purchasePrice: pace.marketPrice,
          discount: pace.discount,
          saleDate: purchaseDate,
          assumedSaleDate: saleDate,
          refund: pace.monthlyRefund * 12,
        };
        const sale = e.holdShares
          ? { proceeds: 0, ordinary: 0, shortGain: 0, longGain: 0, held: true }
          : sellLot(
              lot,
              saleDate,
              e.salePrice,
              (e.fee * 12) / pace.periodMonths,
              e.qualifiedPlan,
            );
        for (const m of months) {
          m.esppContrib = pace.monthlyContribution;
          m.esppSalaryContrib = pace.monthlyContribution;
          m.esppRefund = pace.monthlyRefund;
          m.esppProceeds = sale.proceeds / 12;
          m.ordinary = sale.ordinary / 12;
          m.shortGain = sale.shortGain / 12;
          m.longGain = sale.longGain / 12;
          if (!e.qualifiedPlan) m.rsu += pace.monthlyValue - pace.monthlyCost;
        }
        lots.push({ ...lot, ...sale });
        if (e.holdShares) stockAssets += pace.monthlyValue * 12;
      }
      return {
        months,
        stockAssets,
        openingAssets,
        lots,
        rsuVests,
        offerings,
        payrollDeductions,
      };
    }
    if (e.enabled) {
      const period = Math.max(1, Math.round(e.periodMonths)),
        start = e.start || `${baseYear}-01-01`;
      const usage = {},
        payrollUsage = {};
      for (let i = 0; i < 1200; i++) {
        const grantDate = addMonths(start, i * period);
        if (Number(grantDate.slice(0, 4)) > year) break;
        const election = e.enrollments?.[grantDate] || {};
        const enrolled =
          election.enrolled ??
          ((e.autoEnroll ?? true) &&
            (!e.firstEnrollmentDate || grantDate >= e.firstEnrollmentDate));
        const { next, endDate, purchaseDate } = offeringDates(e, grantDate),
          py = Number(purchaseDate.slice(0, 4));
        if (!enrolled) {
          offerings.push({
            grantDate,
            endDate,
            purchaseDate,
            enrolled: false,
            contributions: 0,
          });
          continue;
        }
        const rate = clamp(
          election.rate ?? e.rate,
          e.minRate ?? 0,
          e.maxRate ?? 1,
        );
        let cash = 0;
        for (
          let cy = Number(grantDate.slice(0, 4));
          cy <= Math.min(year, py);
          cy++
        ) {
          if (
            (options.stopYear && cy >= options.stopYear) ||
            options.history?.[cy]?.employed === false ||
            (cy === year && options.employed === false)
          )
            continue;
          const annual =
            cy === year
              ? salary
              : (options.history?.[cy]?.salary ??
                c.salary * (1 + c.salaryGrowth) ** Math.max(0, cy - baseYear));
          const annualBonus =
            cy === year
              ? bonus
              : annual *
                (options.history?.[cy]?.bonusPercent ?? c.bonusPercent);
          const checks =
              cy === year && options.payrollSchedule
                ? options.payrollSchedule.rows.map((r) => r.date)
                : paydays(c, cy),
            bonusChecks = checks.filter(
              (d) => Number(d.slice(5, 7)) === c.bonusMonth,
            );
          for (const payday of checks) {
            if (
              payday < grantDate ||
              payday >= next ||
              payday > endDate ||
              payday > purchaseDate ||
              (e.employmentStart && payday < e.employmentStart) ||
              (e.employmentEnd && payday > e.employmentEnd)
            )
              continue;
            const cm = Number(payday.slice(5, 7)) - 1;
            if (
              options.payrollSchedule?.rows.find((r) => r.date === payday)
                ?.source !== "uploaded" &&
              e.stopAtAnnualLimit &&
              (usage[cy] || 0) >= positive(e.annualFmvLimit) - 0.000001
            )
              continue;
            const salaryPart = (annual / checks.length) * rate;
            let deduction =
              salaryPart +
              (e.bonusEligible && cm === c.bonusMonth - 1
                ? (annualBonus / Math.max(1, bonusChecks.length)) * rate
                : 0);
            if (cy === year && options.payrollSchedule)
              deduction = options.payrollSchedule.rows
                .filter((r) => r.date === payday)
                .reduce((n, r) => n + r.espp, 0);
            if (e.payrollRounding)
              deduction = Math.round(deduction * 100) / 100;
            if (
              options.payrollSchedule?.rows.find((r) => r.date === payday)
                ?.source !== "uploaded"
            )
              deduction = Math.min(
                deduction,
                Math.max(
                  0,
                  (positive(e.annualPayrollCap) || Infinity) -
                    (payrollUsage[cy] || 0),
                ),
              );
            payrollUsage[cy] = (payrollUsage[cy] || 0) + deduction;
            cash += deduction;
            if (cy === year) {
              payrollDeductions[payday] = deduction;
              months[cm].esppContrib += deduction;
              months[cm].esppSalaryContrib += Math.min(salaryPart, deduction);
            }
          }
        }
        offerings.push({
          grantDate,
          endDate,
          purchaseDate,
          enrolled: true,
          rate,
          contributions: cash,
        });
        if (e.employmentEnd && e.employmentEnd < purchaseDate) {
          if (Number(e.employmentEnd.slice(0, 4)) === year)
            months[Number(e.employmentEnd.slice(5, 7)) - 1].esppRefund += cash;
          continue;
        }
        if (py > year) {
          stockAssets += cash;
          continue;
        }
        // Calendar ledger: FMV room is tracked per purchase year across offerings.
        const {
          shares,
          price,
          cost,
          refund,
          grantPrice: gp,
          marketPrice: pp,
        } = EquitySchedule.esppPurchase(e, {
          cash,
          offerPrice: election.offerPrice ?? e.offerPrice,
          purchasePrice: election.purchasePrice ?? e.purchasePrice,
          fmvRoom: EquitySchedule.esppFmvLimit(e, py) - (usage[py] || 0),
        });
        usage[py] = (usage[py] || 0) + shares * gp;
        const saleDate = addMonths(purchaseDate, positive(e.holdMonths));
        const sy = e.holdShares ? Infinity : Number(saleDate.slice(0, 4));
        const lot = {
          grantDate,
          purchaseDate,
          shares,
          cost,
          grantPrice: gp,
          purchasePrice: pp,
          discount: e.discount,
          saleDate,
          refund,
        };
        const sale = e.holdShares
          ? {
              proceeds: 0,
              ordinary: 0,
              gain: 0,
              longGain: 0,
              shortGain: 0,
              qualified: false,
              held: true,
            }
          : sellLot(
              lot,
              saleDate,
              election.salePrice ?? e.salePrice,
              e.fee,
              e.qualifiedPlan,
            );
        if (py === year) {
          months[Number(purchaseDate.slice(5, 7)) - 1].esppRefund += refund;
          if (!e.qualifiedPlan)
            months[Number(purchaseDate.slice(5, 7)) - 1].rsu +=
              shares * (pp - price);
        }
        if (sy === year) {
          const m = months[Number(saleDate.slice(5, 7)) - 1];
          m.esppProceeds += sale.proceeds;
          m.ordinary += sale.ordinary;
          m.shortGain += sale.shortGain;
          m.longGain += sale.longGain;
        }
        if (sy > year) stockAssets += shares * pp;
        if (py < year && sy >= year) openingAssets += shares * pp;
        if (py === year || sy === year)
          lots.push({
            ...lot,
            ...sale,
            openingValue: py < year ? shares * pp : 0,
          });
      }
    }
    return {
      months,
      stockAssets,
      openingAssets,
      lots,
      rsuVests,
      offerings,
      payrollDeductions,
    };
  }

  function calculate(input, year = input.taxYear || 2026, options = {}) {
    const c = merge(defaults(), input),
      warnings = [];
    const coverHistory = options.coverHistory || {};
    if (c.grants.some((g) => rsuMode(g) === "cover"))
      for (let prior = c.taxYear; prior < year; prior++) {
        if (coverHistory[prior] === undefined)
          coverHistory[prior] =
            options.history?.[prior]?.rsuSellToCover ??
            calculate(c, prior, {
              ...options,
              coverHistory,
              salary: options.history?.[prior]?.salary,
              bonusPercent: options.history?.[prior]?.bonusPercent,
              employed: options.history?.[prior]?.employed,
            }).rsuSellToCover;
      }
    if (!Number.isInteger(year) || year < 2026 || year > 2200)
      throw new Error("Tax year must be between 2026 and 2200.");
    const offset = year - c.taxYear,
      age = c.age + offset;
    c.grants.forEach((g, i) => {
      if (g.cliff > g.months)
        warnings.push(
          `Grant ${i + 1}: cliff exceeds vesting duration. The calculation uses the final vest month; correct the schedule before relying on it.`,
        );
    });
    const l = limits(year, c.tax),
      r = c.retirement,
      h = c.hsa,
      b = c.benefits;
    let salary =
      options.employed === false
        ? 0
        : positive(options.salary ?? c.salary * (1 + c.salaryGrowth) ** offset);
    let bonus = salary * clamp(options.bonusPercent ?? c.bonusPercent, 0, 10);
    let eq = equity(c, year, salary, bonus, options);
    if (options.rsuOverride !== undefined) {
      for (const m of eq.months) {
        m.rsu = positive(options.rsuOverride) / 12;
        m.rsuCash = m.rsu;
      }
    }
    const rsuGross = sum(eq.months, "rsu"),
      rsuCash = sum(eq.months, "rsuCash");
    let grossEligible =
      salary + (r.bonusEligible ? bonus : 0) + (r.rsuEligible ? rsuGross : 0);
    let eligible = Math.min(l.compensation, grossEligible);
    const grow = (1 + r.contributionGrowth) ** Math.max(0, offset);
    const prior = offset === 0;
    const cap = (name, value, limit) => {
      const n = positive(value),
        allowed = Math.max(0, limit);
      if (n > allowed + 0.01)
        warnings.push(
          `${name} capped at ${Math.round(allowed).toLocaleString("en-US")}.`,
        );
      return Math.min(n, allowed);
    };
    const catchup =
      age >= 60 && age <= 63 ? l.superCatchup : age >= 50 ? l.catchup : 0;
    const employeeRoom = Math.min(
      eligible,
      l.deferral + catchup - (prior ? r.priorDeferrals : 0),
    );
    let traditional = cap(
      "Traditional 401(k)",
      r.max401k
        ? employeeRoom - Math.min(employeeRoom, positive(r.roth))
        : r.traditional * grow,
      employeeRoom,
    );
    let roth = cap(
      "Roth 401(k)",
      r.max401k ? r.roth : r.roth * grow,
      employeeRoom - traditional,
    );
    if (
      catchup &&
      (r.priorYearWages || (r.max401k ? salary / (1 + c.salaryGrowth) : 0)) >
        l.rothCatchupThreshold &&
      traditional > l.deferral
    ) {
      roth += traditional - l.deferral;
      traditional = l.deferral;
      warnings.push(
        "Catch-up contributions moved to Roth based on prior-year wages.",
      );
    }
    const regularDeferrals = Math.min(
      l.deferral,
      traditional + roth + (prior ? r.priorDeferrals : 0),
    );
    let employer = cap(
      "Employer contribution",
      r.employerAnnual * grow +
        Math.min(traditional + roth, eligible * r.matchPercent) * r.matchRate,
      Math.min(eligible, l.total401k) -
        regularDeferrals -
        (prior ? r.priorEmployer + r.priorAfterTax : 0),
    );
    let mega = cap(
      "Mega backdoor",
      r.megaEnabled
        ? r.maxMega
          ? Math.max(
              0,
              Math.min(eligible, l.total401k) -
                regularDeferrals -
                employer -
                (prior ? r.priorEmployer + r.priorAfterTax : 0),
            )
          : r.mega * grow
        : 0,
      Math.min(
        r.megaAnnualCap == null ? Infinity : positive(r.megaAnnualCap),
        Math.min(eligible, l.total401k) -
          regularDeferrals -
          employer -
          (prior ? r.priorEmployer + r.priorAfterTax : 0),
      ),
    );
    const hsaLimit = h.eligible
      ? (((h.coverage === "family" ? l.hsaFamily : l.hsaSingle) +
          (age >= 55 ? l.hsaCatchup : 0)) *
          clamp(h.eligibleMonths, 0, 12)) /
        12
      : 0;
    let hsaEmployer = cap(
      "Employer HSA",
      salary ? h.employer * grow : 0,
      hsaLimit - (prior ? h.prior : 0),
    );
    let hsa = cap(
      "Employee HSA",
      salary
        ? h.maxContribution
          ? Math.max(0, hsaLimit - hsaEmployer - (prior ? h.prior : 0))
          : h.employee * grow
        : 0,
      hsaLimit - hsaEmployer - (prior ? h.prior : 0),
    );
    let benefits = salary
      ? (positive(b.health) +
          positive(b.dental) +
          positive(b.vision) +
          positive(b.fsa) +
          positive(b.otherPretax)) *
        12
      : 0;
    let postBenefits = salary ? positive(b.otherPosttax) * 12 : 0;
    let calendar;
    {
      calendar = PayrollCalendar.build(c, year, {
        dates: paydays(c, year),
        salary,
        bonus,
        limits: l,
        employed: options.employed !== false,
        targets: {
          traditional,
          roth,
          mega,
          hsa,
          employer,
          hsaEmployer,
          health: benefits,
          post: postBenefits,
          esppByDate: eq.payrollDeductions,
        },
      });
      ({ salary, bonus, traditional, roth, mega, hsa, employer, hsaEmployer } =
        calendar.totals);
      grossEligible =
        salary + (r.bonusEligible ? bonus : 0) + (r.rsuEligible ? rsuGross : 0);
      eligible = Math.min(l.compensation, grossEligible);
      benefits = calendar.totals.health;
      postBenefits = calendar.totals.post;
      eq = equity(c, year, salary, bonus, {
        ...options,
        payrollSchedule: calendar,
      });
      for (const row of calendar.rows)
        if (row.source === "forecast")
          row.espp = eq.payrollDeductions[row.date] || 0;
      for (let m = 0; m < 12; m++) {
        const actualFunding = PayrollCalendar.sum(
          calendar.rows.filter((r) => Number(r.date.slice(5, 7)) === m + 1),
          "espp",
        );
        const unmatched = actualFunding - eq.months[m].esppContrib;
        if (Math.abs(unmatched) > 0.01) {
          eq.stockAssets += unmatched;
          eq.months[m].esppContrib = actualFunding;
          if (!options.earningEspp)
            warnings.push(
              "Some recorded ESPP funding falls outside the configured offering dates and remains pending cash. Review enrollment.",
            );
        }
      }
      calendar.totals.espp = PayrollCalendar.sum(calendar.rows, "espp");
      PayrollCalendar.withholding(calendar, c, year, TaxEngine, eq);
      warnings.push(...calendar.warnings);
    }
    if (
      (b.fsa > 0 ||
        calendar.rows.some((row) =>
          row.benefitDetails?.some((b) => b.category === "fsa" && b.value > 0),
        )) &&
      hsa > 0
    )
      warnings.push(
        "HSA eligibility requires a compatible limited-purpose FSA; confirm your plan.",
      );
    const other = Number(options.otherIncome ?? c.tax.otherIncome) || 0;
    const spouse = positive(options.spouseIncome ?? c.tax.spouseIncome);
    const conversionEarnings =
      mega *
      ((1 + Math.max(0, c.stockGrowth)) ** (r.conversionDelayMonths / 12) - 1);
    const dependentCare = calendar.rows
      .flatMap((r) => r.benefitDetails || [])
      .filter((b) => b.category === "dependentCare")
      .reduce((n, b) => n + b.value, 0);
    const income = {
      stateBenefitAddback:
        c.tax.state === "CA" ? Math.max(0, dependentCare - 5000) : 0,
      wages:
        salary +
        bonus +
        rsuGross +
        calendar.totals.imputed +
        (calendar.totals.taxableAllowance || 0) +
        positive(options.extraWages),
      spouse,
      ordinary: other + sum(eq.months, "ordinary") + conversionEarnings,
      shortGain:
        sum(eq.months, "shortGain") -
        positive(
          options.capitalLossCarry ??
            (year === c.taxYear ? c.tax.capitalLossCarry : 0),
        ),
      longGain: sum(eq.months, "longGain"),
      pretax: traditional,
      payrollDeduction: benefits,
      hsa,
      hsaPayroll: h.payroll ? hsa : 0,
      employerHsa: hsaEmployer,
    };
    const approxMagi =
      income.wages +
      spouse +
      income.ordinary -
      traditional -
      benefits -
      hsa +
      income.shortGain +
      income.longGain;
    const phaseStart =
      (c.tax.filing === "married" ? 242000 : 153000) *
      (1 + c.tax.bracketGrowth) ** Math.max(0, year - 2026);
    const phaseWidth = c.tax.filing === "married" ? 10000 : 15000;
    const iraLimit = Math.min(
      salary + bonus + spouse,
      l.ira + (age >= 50 ? l.iraCatchup : 0),
    );
    const rothRoom = Math.max(
      0,
      Math.ceil(
        (iraLimit *
          clamp((phaseStart + phaseWidth - approxMagi) / phaseWidth, 0, 1)) /
          10,
      ) * 10,
    );
    const ira = cap(
      "IRA contribution",
      r.maxIra ? (r.iraMode === "roth" ? rothRoom : iraLimit) : r.ira * grow,
      r.iraMode === "roth" ? rothRoom : iraLimit,
    );
    const iraConversionAudit = {
      startingBalance: positive(options.iraStartingBalance),
      additionalBalance: positive(r.iraPretaxBalance),
      pretaxBalance: positive(options.iraPretaxBalance ?? r.iraPretaxBalance),
      existingBasis: positive(r.iraBasis),
      contribution: ira,
      nontaxable: 0,
    };
    let iraTaxableConversion = 0;
    if (r.iraMode === "backdoor" && ira > 0) {
      iraTaxableConversion =
        ira *
        Math.max(
          0,
          1 -
            Math.min(
              1,
              (positive(r.iraBasis) + ira) /
                Math.max(
                  1,
                  positive(options.iraPretaxBalance ?? r.iraPretaxBalance) +
                    positive(r.iraBasis) +
                    ira,
                ),
            ),
        );
      iraConversionAudit.nontaxable = ira - iraTaxableConversion;
      income.ordinary += iraTaxableConversion;
      if (iraTaxableConversion > 0)
        warnings.push(
          "Backdoor IRA conversion includes taxable income under the pro-rata calculation.",
        );
    }
    const taxes = tax(income, year, c.tax);
    const employee = traditional + roth + mega + hsa + ira;
    const monthly = [];
    let cumSpouseWages = 0;
    for (let m = 0; m < 12; m++) {
      const dated = calendar.rows.filter(
          (p) => Number(p.date.slice(5, 7)) === m + 1,
        ),
        cs = (key) => PayrollCalendar.sum(dated, key);
      const equityTax = calendar.equityTaxes.filter(
          (e) => Number(e.date.slice(5, 7)) === m + 1,
        ),
        et = (key) => sum(equityTax, key),
        q = eq.months[m];
      const base = cs("salary"),
        bm = cs("bonus"),
        mt = cs("traditional"),
        mr = cs("roth"),
        mm = cs("mega"),
        retirement = mt + mr + mm,
        health = cs("health"),
        hs = cs("hsa"),
        post = cs("post");
      const spouseWages = spouse / 12;
      const spouseFica =
        0.062 *
          (Math.min(l.ssBase, cumSpouseWages + spouseWages) -
            Math.min(l.ssBase, cumSpouseWages)) +
        spouseWages * 0.0145 +
        0.009 *
          (Math.max(0, cumSpouseWages + spouseWages - 200000) -
            Math.max(0, cumSpouseWages - 200000));
      const spouseFederal =
        c.tax.withholdingMethod === "w4"
          ? (c.tax.spouseFederalWithholding == null
              ? TaxEngine.federalWithholding(spouse, year, {
                  ...c.tax,
                  w4Credits: 0,
                  w4OtherIncome: 0,
                  w4Deductions: 0,
                })
              : positive(c.tax.spouseFederalWithholding)) / 12
          : 0;
      const federal = cs("federal") + et("federal") + spouseFederal,
        state = cs("state") + et("state");
      const fica =
          cs("ss") + cs("medicare") + et("ss") + et("medicare") + spouseFica,
        sdi =
          cs("sdi") +
          et("sdi") +
          (c.tax.state === "CA" ? spouseWages * c.tax.caSdi : 0);
      const withholding = federal + state + fica + sdi,
        rsuWithholding =
          et("federal") + et("state") + et("ss") + et("medicare") + et("sdi");
      const rsuSellToCover = Math.min(
        q.rsuCoverEligible,
        Math.max(
          0,
          c.tax.rsuCoverRate == null
            ? (rsuWithholding * q.rsuCoverEligible) / Math.max(1e-20, q.rsu)
            : q.rsuCoverEligible * c.tax.rsuCoverRate,
        ),
      );
      const receipts =
        base +
        bm +
        (cs("allowance") + cs("taxableAllowance")) +
        q.rsuCash +
        q.esppProceeds +
        q.esppRefund +
        spouse / 12 +
        other / 12;
      const bankCash =
        receipts -
        retirement -
        hs -
        ira / 12 -
        health -
        post -
        q.esppContrib -
        withholding +
        rsuSellToCover;
      monthly.push({
        month: m + 1,
        checks: dated.length,
        spouseIncome: spouse / 12,
        otherIncome: other / 12,
        salary: base,
        allowance: cs("allowance") + cs("taxableAllowance"),
        imputed: cs("imputed"),
        bonus: bm,
        rsu: q.rsu,
        rsuCash: q.rsuCash,
        esppSaleProceeds: q.esppProceeds,
        esppRefund: q.esppRefund,
        payrollHsa: h.payroll ? hs : 0,
        accountContributions: {
          traditional: mt,
          roth: mr,
          mega: mm,
          hsa: hs,
          ira: ira / 12,
          employer: cs("employer"),
          hsaEmployer: cs("hsaEmployer"),
          totalEmployee: retirement + hs + ira / 12,
        },
        esppContributions: q.esppContrib,
        esppProceeds: q.esppProceeds + q.esppRefund,
        contributions: retirement + hs + ira / 12,
        benefits: health + post,
        pretaxBenefits: health,
        withholding,
        rsuWithholding,
        rsuPayrollTax: et("ss") + et("medicare") + et("sdi"),
        rsuSellToCover,
        cashWithholding: withholding - rsuSellToCover,
        federal,
        state,
        fica,
        sdi,
        bankCash,
        regularCash: cs("netPay"),
      });
      cumSpouseWages += spouseWages;
    }
    const rsuSellToCover = sum(monthly, "rsuSellToCover");
    coverHistory[year] = rsuSellToCover;
    eq.stockAssets -= rsuSellToCover;
    for (const [prior, value] of Object.entries(coverHistory))
      if (Number(prior) < year) {
        eq.stockAssets -= value * (1 + c.stockGrowth) ** (year - Number(prior));
        eq.openingAssets -=
          value * (1 + c.stockGrowth) ** (year - 1 - Number(prior));
      }
    const withholding = sum(monthly, "withholding"),
      bankCash = sum(monthly, "bankCash");
    const taxBalance = taxes.total - withholding;
    const espp = {
      contributions: sum(eq.months, "esppContrib"),
      proceeds: sum(eq.months, "esppProceeds"),
      refunds: sum(eq.months, "esppRefund"),
      ordinary: sum(eq.months, "ordinary"),
      shortGain: sum(eq.months, "shortGain"),
      longGain: sum(eq.months, "longGain"),
      lots: eq.lots,
      offerings: eq.offerings,
    };
    const taxFunding = TaxEngine.funding(
      taxes,
      { withholding, rsuSellToCover },
      c.tax.estimatedPayments,
    );
    taxFunding.esppSaleTax =
      taxes.total -
      tax(
        {
          ...income,
          ordinary: income.ordinary - espp.ordinary,
          shortGain: income.shortGain - espp.shortGain,
          longGain: income.longGain - espp.longGain,
        },
        year,
        c.tax,
      ).total;
    let futureTaxReserve = 0,
      futureTaxIncome = { ordinary: 0, shortGain: 0, longGain: 0 };
    if (c.espp.reserveFutureTax && c.espp.qualifiedPlan) {
      const hypothetical = espp.lots
        .filter((l) => l.held && Number(l.purchaseDate.slice(0, 4)) === year)
        .map((l) =>
          sellLot(
            l,
            addMonths(l.purchaseDate, positive(c.espp.reserveSaleMonths)),
            positive(c.espp.salePrice),
            c.espp.fee,
          ),
        );
      futureTaxIncome = {
        ordinary: sum(hypothetical, "ordinary"),
        shortGain: sum(hypothetical, "shortGain"),
        longGain: sum(hypothetical, "longGain"),
      };
      futureTaxReserve = Math.max(
        0,
        tax(
          {
            ...income,
            ordinary: income.ordinary + sum(hypothetical, "ordinary"),
            shortGain: income.shortGain + sum(hypothetical, "shortGain"),
            longGain: income.longGain + sum(hypothetical, "longGain"),
          },
          year,
          c.tax,
        ).total - taxes.total,
      );
    }
    if (
      employee + benefits + postBenefits + espp.contributions >
      salary + bonus
    )
      warnings.push(
        "Contributions and deductions exceed cash wages; review paycheck funding.",
      );
    if (monthly.some((m) => m.bankCash < 0))
      warnings.push(
        "Some months need cash from savings. Review the monthly schedule.",
      );
    if (c.grants.some((g) => rsuMode(g) === "hold"))
      warnings.push(
        "Held RSU taxes are funded from cash. Shares remain invested until you change the sale assumption.",
      );
    if (c.tax.state === "CA")
      warnings.push(
        "California income tax uses 2025 FTB tables projected to 2026 with the editable CA adjustment.",
      );
    if (taxes.lossCarryforward)
      warnings.push(
        "Unused capital losses carry into later years in the lifetime projection.",
      );
    if (c.tax.spouseIncome)
      warnings.push(
        "Spouse wages affect household taxes. Use withholding overrides to reconcile both paychecks.",
      );
    if (r.iraMode === "backdoor")
      warnings.push(
        "IRA pro-rata inputs are annual planning estimates; update year-end IRA balances before relying on conversion tax.",
      );
    return {
      year,
      paychecks: calendar.rows,
      payrollCalendar: calendar,
      benefitDetails: calendar.rows.flatMap((row) =>
        (row.benefitDetails || []).map((b) => ({ ...b, date: row.date })),
      ),
      cashAllowance:
        calendar.totals.allowance + (calendar.totals.taxableAllowance || 0),
      imputedIncome: calendar.totals.imputed,
      deductionSources: {
        salary:
          traditional -
          calendar.rows.reduce(
            (n, p) =>
              n +
              (r.bonusEligible
                ? (p.traditional * p.bonus) / Math.max(1, p.salary + p.bonus)
                : 0),
            0,
          ) +
          benefits +
          hsa,
        bonus: calendar.rows.reduce(
          (n, p) =>
            n +
            (r.bonusEligible
              ? (p.traditional * p.bonus) / Math.max(1, p.salary + p.bonus)
              : 0),
          0,
        ),
        rsu: 0,
      },
      taxFunding,
      futureTaxReserve,
      futureTaxIncome,
      limits: l,
      months: monthly,
      salary,
      bonus,
      rsuGross,
      rsuCash,
      rsuSellToCover,
      cashWithholding: withholding - rsuSellToCover,
      rsuVests: eq.rsuVests,
      gross: salary + bonus + rsuGross,
      otherIncome: other,
      income,
      taxes,
      withholding,
      bankCash,
      taxBalance,
      afterTaxCash: bankCash - taxBalance,
      regularMonthly: sum(monthly, "regularCash") / 12,
      remainingCash: monthly
        .filter((m) => m.month >= c.forecastFromMonth)
        .reduce((n, m) => n + m.bankCash, 0),
      contributions: {
        traditional,
        roth,
        mega,
        employer,
        hsa,
        hsaEmployer,
        ira,
        totalEmployee: employee,
        iraTaxableConversion,
        conversionEarnings,
        iraConversionAudit,
      },
      benefits: benefits + postBenefits,
      espp,
      stockAssets: eq.stockAssets,
      openingAssets: eq.openingAssets,
      warnings: [...new Set(warnings)],
    };
  }
  function cashFlow(payroll, options = {}) {
    const taxes = options.taxes || payroll.taxes;
    const expenses = Number(options.expenses) || 0;
    const socialSecurity = Number(options.socialSecurity) || 0;
    const otherIncome = payroll.otherIncome || 0;
    const cashIn =
      payroll.salary +
      (payroll.cashAllowance || 0) +
      payroll.bonus +
      payroll.rsuCash +
      payroll.income.spouse +
      otherIncome +
      payroll.espp.proceeds +
      payroll.espp.refunds +
      socialSecurity;
    const cashOut =
      taxes.total -
      (payroll.rsuSellToCover || 0) +
      payroll.contributions.totalEmployee +
      payroll.benefits +
      payroll.espp.contributions +
      expenses;
    const taxFunding = TaxEngine.funding(
      taxes,
      payroll,
      payroll.taxFunding?.estimatedPayments,
    );
    const taxBalance = taxFunding.remainingLiability;
    let futureTaxReserve = payroll.futureTaxReserve || 0;
    if (taxes.audit) {
      const { income, year, settings } = taxes.audit,
        e = payroll.espp,
        future = payroll.futureTaxIncome || {};
      taxFunding.esppSaleTax =
        taxes.total -
        tax(
          {
            ...income,
            ordinary: (income.ordinary || 0) - e.ordinary,
            shortGain: (income.shortGain || 0) - e.shortGain,
            longGain: (income.longGain || 0) - e.longGain,
          },
          year,
          settings,
        ).total;
      futureTaxReserve = Math.max(
        0,
        tax(
          {
            ...income,
            ordinary: (income.ordinary || 0) + (future.ordinary || 0),
            shortGain: (income.shortGain || 0) + (future.shortGain || 0),
            longGain: (income.longGain || 0) + (future.longGain || 0),
          },
          year,
          settings,
        ).total - taxes.total,
      );
    }
    const months = payroll.months.map((month) => {
      const bankCash =
        month.bankCash + (socialSecurity - taxFunding.estimatedPayments) / 12;
      const livingExpenses = expenses / 12;
      const taxAdjustment = taxBalance / 12;
      return {
        ...month,
        socialSecurity: socialSecurity / 12,
        bankCash,
        estimatedTaxPayments: taxFunding.estimatedPayments / 12,
        futureTaxReserve: futureTaxReserve / 12,
        livingExpenses,
        taxAdjustment,
        netCashFlow: bankCash - livingExpenses - taxAdjustment,
        spendableCashFlow:
          bankCash - livingExpenses - taxAdjustment - futureTaxReserve / 12,
      };
    });
    const taxAttribution = taxes.audit
      ? TaxEngine.attribute(taxes, payroll, taxFunding.estimatedPayments)
      : null;
    return {
      cashIn,
      cashOut,
      taxAttribution,
      taxFunding,
      futureTaxReserve,
      spendableCashFlow: cashIn - cashOut - futureTaxReserve,
      netCashFlow: cashIn - cashOut,
      afterTaxCash: cashIn - cashOut + expenses,
      taxes,
      taxBalance,
      expenses,
      socialSecurity,
      otherIncome,
      months,
    };
  }
  function ongoing(input, options = {}) {
    const c = merge(defaults(), input),
      parser =
        typeof module !== "undefined" && module.exports
          ? require("./paystub-parser")
          : root.PaystubParser;
    const baseline = parser.suggest(c.payroll.records || [], c);
    c.payroll.elections = {
      ...c.payroll.elections,
      ...baseline.elections,
      ...Object.fromEntries(
        Object.entries(c.payroll.elections || {}).filter(
          ([key, e]) =>
            e.manual || e.sourceDate === baseline.elections?.[key]?.sourceDate,
        ),
      ),
    };
    c.payroll.benefitPlans = parser.benefitPlans(c.payroll.records || []);
    c.payroll.ongoing = true;
    c.payroll.records = [];
    c.payroll.useYtd = false;
    if (baseline.record) {
      const count = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 }[
        c.frequency
      ];
      if (
        !c.payroll.manualFields?.some(
          (k) =>
            k.startsWith("employerPlan.retirement.employer") ||
            k.includes("match"),
        )
      )
        c.retirement.employerAnnual = Math.max(
          (baseline.record.current.employer || 0) * count,
          ...(input.payroll?.records || [])
            .filter((r) => Number(r.date.slice(0, 4)) === c.taxYear)
            .map((r) => r.ytd?.employer || 0),
        );
      if (baseline.record.current.hsaEmployer != null)
        c.hsa.employer = baseline.record.current.hsaEmployer * count;
    }
    const date = EquitySchedule.asOf(c.taxYear, options.asOf);
    const active = EquitySchedule.instances(c.grants, date)
      .map((g) => ({ ...g, pace: EquitySchedule.pace(g, date) }))
      .filter((g) => g.pace.monthlyGrant > 0);
    c.grants = active.map((g) => ({
      ...g,
      value: g.pace.monthlyGrant * 12,
      months: 12,
      cliff: 0,
      interval: 1,
      evenVesting: true,
      repeat: false,
      start: `${c.taxYear - 1}-12-31`,
    }));
    const esppPace = EquitySchedule.esppPace(c, date);
    const result = calculate(c, c.taxYear, {
      ...options,
      earningEspp: esppPace,
      earningDate: date,
    });
    result.rsuVests.forEach(
      (v) => (v.grantIndex = active[v.grantIndex].sourceIndex),
    );
    result.earningPace = {
      asOf: date,
      grants: active.map((g) => ({
        name: g.name,
        index: g.sourceIndex,
        ...g.pace,
      })),
      espp: esppPace,
    };
    return result;
  }
  const api = {
    grantAllocations: EquitySchedule.allocations,
    ongoing,
    offeringDates,
    rsuMode,
    defaults,
    merge,
    limits,
    tax,
    calculate,
    cashFlow,
    sellLot,
    paydays,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Compensation = api;
})(typeof window !== "undefined" ? window : globalThis);
