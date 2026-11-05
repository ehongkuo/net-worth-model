(function (root) {
  "use strict";
  const parser = () =>
    typeof module !== "undefined" && module.exports
      ? require("./paystub-parser")
      : root.PaystubParser;
  function describe(s) {
    const records = [...s.uploads.records]
        .filter((r) => (r.kind || "regular") === "regular")
        .sort((a, b) => a.date.localeCompare(b.date)),
      last = records.at(-1),
      prior = records.at(-2),
      v = last?.current || {};
    const found = parser().payFrequency(records, s.compensation.frequency),
      frequency = found.guessed ? s.compensation.frequency : found.frequency,
      confirmed = !found.guessed,
      count = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 }[
        frequency
      ];
    const questions = [];
    const add = (id, title, why) => questions.push({ id, title, why });
    if (last && !confirmed)
      add(
        "schedule",
        "Confirm your pay schedule",
        "These documents do not establish a reliable recurring schedule.",
      );
    if (v.espp > 0)
      add(
        "espp",
        "Confirm your ESPP terms",
        "We found payroll deposits. Offering dates, discount, prices and enrollment determine when they become shares.",
      );
    if (v.hsa > 0 || v.hsaEmployer > 0)
      add(
        "hsa",
        "Confirm HSA coverage and eligibility",
        "Your contribution allowance depends on coverage and eligible months. Employer funding counts too.",
      );
    if (v.mega > 0)
      add(
        "mega",
        "Confirm after-tax plan rules",
        "Confirm Roth conversion and any tighter employer contribution cap.",
      );
    if ((last?.ytd?.employer || 0) > 0 && !v.employer)
      add(
        "employer",
        "Check employer retirement funding",
        "A YTD payment is present, but no recurring payment appears on the latest check. We cannot infer a match formula.",
      );
    if (prior && (prior.current.allowance || 0) !== (v.allowance || 0))
      add(
        "allowance",
        "Check occasional cash allowances",
        "The allowance differs between checks. Actual payments are preserved; the latest check supplies the recurring forecast.",
      );
    const snapshot = {
      salary: v.salary || 0,
      cash: last?.netPay || 0,
      retirement:
        (v.traditional || 0) +
        (v.roth || 0) +
        (v.mega || 0) +
        (v.employer || 0),
      hsa: (v.hsa || 0) + (v.hsaEmployer || 0),
      espp: v.espp || 0,
      employerRetirement: v.employer || 0,
    };
    return {
      last,
      records: records.length,
      schedule: {
        frequency,
        confirmed,
        anchor: last?.date || s.compensation.firstPayday,
        salary: last ? (v.salary || 0) * count : s.compensation.salary,
      },
      snapshot,
      questions,
    };
  }
  function hasIncome(s) {
    return (
      s.compensation.salary > 0 ||
      s.compensation.grants.some((g) => g.value > 0 || g.shares > 0) ||
      s.uploads.records.some((r) =>
        ["salary", "bonus", "rsu", "allowance"].some((k) => r.current?.[k] > 0),
      )
    );
  }
  const initialView = (s) => (hasIncome(s) ? "monthly" : "welcome");
  const read = (s, path) => path.split(".").reduce((v, k) => v?.[k], s);
  function write(s, path, value) {
    const keys = path.split(".");
    let target = s;
    for (const key of keys.slice(0, -1)) target = target[key] ??= {};
    target[keys.at(-1)] = value;
  }
  // Values worked out from a paystub follow the inputs they came from when
  // those change, unless the user set or confirmed them.
  function rederive(s, path) {
    const own = (p) =>
      s.uploads.fieldSources?.[p] &&
      !s.uploads.manualFields?.includes(p) &&
      !Object.hasOwn(s.uploads.confirmedFields || {}, p);
    const records = [...(s.uploads.records || [])].sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
      last = records.filter((r) => (r.kind || "regular") === "regular").at(-1),
      checks = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 }[
        s.compensation.frequency
      ];
    if (path === "compensation.frequency" && last) {
      if (own("compensation.salary") && last.current.salary > 0)
        s.compensation.salary = parser().annualSalary(
          last.current.salary,
          s.compensation.frequency,
        );
      if (
        own("employerPlan.retirement.employerAnnual") &&
        last.current.employer > 0
      )
        s.employerPlan.retirement.employerAnnual =
          last.current.employer * checks;
    }
    const bonusCheck = records.findLast(
      (r) =>
        ["regular", "bonus"].includes(r.kind || "regular") &&
        r.current.bonus > 0,
    );
    if (
      own("compensation.bonusPercent") &&
      bonusCheck &&
      s.compensation.salary > 0
    )
      s.compensation.bonusPercent =
        Math.round((bonusCheck.current.bonus / s.compensation.salary) * 1000) /
        1000;
  }
  function edit(s, path, value) {
    const grantPrice = path.match(/^compensation\.grants\.(\d+)\.grantPrice$/);
    if (grantPrice) {
      // An unset vest price keeps each vest's dollar value: the new grant price
      // changes how many shares the grant is, not what a vest pays.
      const g = s.compensation.grants[Number(grantPrice[1])],
        vestPath = `compensation.grants.${grantPrice[1]}.vestPrice`;
      if (
        g.grantPrice > 0 &&
        value > 0 &&
        !s.uploads.manualFields?.includes(vestPath) &&
        !Object.hasOwn(s.uploads.confirmedFields || {}, vestPath)
      )
        g.vestPrice = (value * (g.vestPrice || g.grantPrice)) / g.grantPrice;
    }
    write(s, path, value);
    const grantEdit = path.match(
      /^compensation\.grants\.(\d+)\.(evenVesting|months)$/,
    );
    if (grantEdit) {
      const g = s.compensation.grants[Number(grantEdit[1])];
      if (
        g.evenVesting === false &&
        (!g.annualAllocations ||
          g.annualAllocations.length !== Math.ceil(g.months / 12))
      )
        g.annualAllocations = (
          typeof module !== "undefined" && module.exports
            ? require("./equity-schedule")
            : root.EquitySchedule
        ).allocations({ ...g, evenVesting: true });
    }
    s.uploads.manualFields = [
      ...new Set([...(s.uploads.manualFields || []), path]),
    ];
    if (["compensation.frequency", "compensation.salary"].includes(path))
      rederive(s, path);
    const annualKeys = {
      "employerPlan.retirement.traditional": "traditional",
      "employerPlan.retirement.roth": "roth",
      "employerPlan.retirement.mega": "mega",
      "employerPlan.hsa.employee": "hsa",
    };
    if (annualKeys[path])
      s.uploads.annualSettingKeys = [
        ...new Set([...(s.uploads.annualSettingKeys || []), annualKeys[path]]),
      ];
    if (path.startsWith("uploads.elections.")) {
      const key = path.split(".")[2];
      s.uploads.elections[key].manual = true;
      if (key === "espp") {
        write(s, "employerPlan.espp.rate", value);
        s.uploads.manualFields.push("employerPlan.espp.rate");
      }
    }
    if (path === "employerPlan.espp.rate") {
      s.uploads.elections.espp = {
        ...s.uploads.elections.espp,
        mode: "percent",
        value,
        manual: true,
      };
    }
  }
  // A paycheck item can be entered in whatever unit the user has on hand.
  // Percents stay percents (they follow raises and bonuses); every dollar unit
  // is stored as an unrounded per-paycheck amount so the entry reads back
  // exactly. `unit` remembers which one the user typed.
  const CHECKS_PER_YEAR = {
    weekly: 52,
    biweekly: 26,
    semimonthly: 24,
    monthly: 12,
  };
  const AMOUNT_UNITS = ["percent", "check", "month", "year"];
  function amountUnits(key) {
    if (["traditional", "roth", "mega", "espp"].includes(key))
      return ["percent", "check", "year"];
    if (key === "hsa") return ["check", "year"];
    return ["check", "month", "year"];
  }
  function payBasis(s, key) {
    const c = s.compensation,
      n = CHECKS_PER_YEAR[c.frequency] || 26,
      salary = c.salary > 0 ? c.salary : describe(s).schedule.salary || 0;
    const bonusEligible =
      key === "espp"
        ? s.employerPlan.espp.bonusEligible
        : ["traditional", "roth", "mega"].includes(key) &&
          s.employerPlan.retirement.bonusEligible;
    return {
      n,
      check: salary / n,
      eligibleYear:
        salary + (bonusEligible ? salary * (c.bonusPercent || 0) : 0),
    };
  }
  function equivalents(s, key, election) {
    const b = payBasis(s, key),
      value = Number(election?.value) || 0;
    const percent = election?.mode === "percent";
    const check = percent ? value * b.check : value,
      year = percent ? value * b.eligibleYear : value * b.n;
    return {
      percent: percent ? value : b.check > 0 ? value / b.check : null,
      check,
      month: year / 12,
      year,
      checks: b.n,
    };
  }
  function setElection(s, key, unit, value) {
    if (!AMOUNT_UNITS.includes(unit)) throw new Error(`Unknown unit: ${unit}`);
    const b = payBasis(s, key),
      amount = Math.max(0, Number(value) || 0);
    const perCheck =
      unit === "year"
        ? amount / b.n
        : unit === "month"
          ? (amount * 12) / b.n
          : amount;
    s.uploads.elections[key] = {
      ...s.uploads.elections[key],
      mode: unit === "percent" ? "percent" : "fixed",
      value: unit === "percent" ? amount : perCheck,
      unit,
      manual: true,
    };
    if (key === "espp" && unit === "percent") {
      write(s, "employerPlan.espp.rate", amount);
      s.uploads.manualFields = [
        ...new Set([
          ...(s.uploads.manualFields || []),
          "employerPlan.espp.rate",
        ]),
      ];
    }
    return s;
  }
  // This calendar year's employee totals before IRS caps (year-to-date from
  // paystubs plus the remaining paychecks), and the employer's deposits.
  function yearTotals(payroll) {
    const requested = payroll?.payrollCalendar?.requested || {},
      c = payroll?.contributions || {};
    return {
      traditional: requested.traditional,
      roth: requested.roth,
      mega: requested.mega,
      hsa: requested.hsa,
      espp: payroll?.espp?.contributions,
      employer: c.employer || 0,
      hsaEmployer: c.hsaEmployer || 0,
    };
  }
  // How an item's yearly total compares with its IRS limit: the general limit
  // (`global`) and the user's own (`limit`), adjusted for age, coverage,
  // eligible months, employer money and other employers. `totals` comes from
  // yearTotals; without it the entered rate is annualized.
  function limitCheck(s, key, totals = {}) {
    if (!["traditional", "roth", "mega", "hsa", "espp"].includes(key))
      return null;
    const TaxEngine =
      typeof module !== "undefined" && module.exports
        ? require("./tax-engine")
        : root.TaxEngine;
    const year = s.taxProfile.year,
      l = TaxEngine.limits(year, s.taxProfile.settings),
      r = s.employerPlan.retirement,
      h = s.employerPlan.hsa,
      e = s.employerPlan.espp,
      elections = s.uploads.elections || {};
    const known = (path) =>
      Object.hasOwn(s.uploads.confirmedFields || {}, path) ||
      (s.uploads.manualFields || []).includes(path) ||
      Boolean(s.uploads.fieldSources?.[path]);
    const usd = (n) =>
      n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      });
    const day = (iso) =>
      new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
    const total = (k) =>
      totals[k] ?? (elections[k] ? equivalents(s, k, elections[k]).year : 0);
    const age = s.taxProfile.age,
      ageKnown = known("taxProfile.age");
    // The newest year-to-date for these keys, from any payslip: an off-cycle
    // payslip's YTD can include regular paychecks not uploaded yet.
    const thisYear = [...(s.uploads.records || [])]
      .filter((x) => x.date.startsWith(String(year)))
      .sort((a, b) => a.date.localeCompare(b.date));
    let latest = null;
    const ytdOf = (keys) => {
      latest = thisYear
        .filter((x) => keys.some((k) => x.ytd?.[k] != null))
        .at(-1);
      return latest
        ? keys.reduce((n, k) => n + (latest.ytd?.[k] || 0), 0)
        : null;
    };
    const notes = [];
    let check;
    if (key === "traditional" || key === "roth") {
      const catchup = !ageKnown
        ? 0
        : age >= 60 && age <= 63
          ? l.superCatchup
          : age >= 50
            ? l.catchup
            : 0;
      const prior = Math.max(0, r.priorDeferrals || 0);
      notes.push(
        `${year} IRS limit: ${usd(l.deferral)} for pre-tax and Roth 401(k) together.`,
      );
      if (catchup)
        notes.push(
          `You can add ${usd(catchup)} more as a catch-up at ${age >= 60 && age <= 63 ? "60 to 63" : "50 or older"}.`,
        );
      else if (!ageKnown)
        notes.push(
          `Add your age: at 50 or older the limit is ${usd(l.catchup)} higher.`,
        );
      if (prior)
        notes.push(
          `Includes ${usd(prior)} from a previous employer this year.`,
        );
      check = {
        label: "Pre-tax + Roth 401(k)",
        global: l.deferral,
        limit: l.deferral + catchup,
        used: total("traditional") + total("roth") + prior,
        ytd: ytdOf(["traditional", "roth"]),
      };
    } else if (key === "mega") {
      const deferred = Math.min(
          l.deferral,
          total("traditional") + total("roth"),
        ),
        employer = totals.employer || 0;
      const room = Math.max(0, l.total401k - deferred - employer),
        cap = r.megaAnnualCap == null ? Infinity : Math.max(0, r.megaAnnualCap);
      notes.push(
        `${year} IRS limit: ${usd(l.total401k)} for all 401(k) money, yours and your employer's. After your ${usd(deferred)} and your employer's ${usd(employer)}, ${usd(room)} is left.`,
      );
      if (cap < room) notes.push(`Your plan caps after-tax at ${usd(cap)}.`);
      check = {
        label: "After-tax 401(k)",
        global: l.total401k,
        limit: Math.min(room, cap),
        used: total("mega"),
        ytd: ytdOf(["mega"]),
      };
    } else if (key === "hsa") {
      const family = h.coverage === "family",
        months = Math.min(12, Math.max(0, h.eligibleMonths ?? 12)),
        catchup = ageKnown && age >= 55 ? l.hsaCatchup : 0,
        base = family ? l.hsaFamily : l.hsaSingle,
        employer = totals.hsaEmployer || 0,
        prior = Math.max(0, h.prior || 0);
      const full = h.eligible ? ((base + catchup) * months) / 12 : 0;
      notes.push(
        `${year} IRS limit: ${usd(l.hsaSingle)} self-only or ${usd(l.hsaFamily)} family, including your employer's deposits.`,
      );
      if (!h.eligible) notes.push("You're marked as not HSA eligible.");
      else {
        if (!known("employerPlan.hsa.coverage"))
          notes.push(
            `Assumes ${family ? "family" : "self-only"} coverage. Confirm it under From your employer.`,
          );
        if (catchup)
          notes.push(`Includes a ${usd(catchup)} catch-up at 55 or older.`);
        if (months < 12) notes.push(`Prorated for ${months} eligible months.`);
        if (employer)
          notes.push(
            `Your employer puts in ${usd(employer)}, which counts toward it.`,
          );
        if (prior)
          notes.push(`Less ${usd(prior)} contributed elsewhere this year.`);
      }
      check = {
        label: "HSA",
        global: base,
        limit: Math.max(0, full - employer - prior),
        used: total("hsa"),
        ytd: ytdOf(["hsa"]),
      };
    } else {
      const limit = l.espp * (1 - Math.min(0.99, Math.max(0, e.discount || 0)));
      notes.push(
        `The IRS allows ${usd(l.espp)} of stock a year, valued at the offering-date price. With your ${Math.round((e.discount || 0) * 100)}% discount that's about ${usd(limit)} in contributions. Plans often cap the percent of pay too.`,
      );
      check = {
        label: "ESPP",
        global: l.espp,
        limit,
        used: total("espp"),
        ytd: ytdOf(["espp"]),
        approx: true,
      };
    }
    if (check.ytd != null && check.ytd > 0)
      notes.push(
        `Includes ${usd(check.ytd)} already in this year, from your ${day(latest.date)} paystub, plus the rest of the year at your current rate.`,
      );
    const remaining = Math.round((check.limit - check.used) * 100) / 100;
    return {
      ...check,
      year,
      ytdDate: check.ytd != null ? latest.date : null,
      remaining,
      over: remaining < -0.005,
      notes,
    };
  }
  // A limited item's path through the calendar year, paycheck by paycheck:
  // what's in so far, where the current rate ends up (payroll stops at the
  // limit), and the per-paycheck amount from the next check that lands on the
  // limit by the last paycheck of the year.
  function limitPlan(s, key, payroll) {
    if (!["traditional", "roth", "mega", "hsa"].includes(key)) return null;
    const year = String(s.taxProfile.year),
      keys = ["traditional", "roth"].includes(key)
        ? ["traditional", "roth"]
        : [key];
    const rows = (payroll?.payrollCalendar?.rows || [])
      .filter((r) => r.date.startsWith(year))
      .sort((a, b) => a.date.localeCompare(b.date));
    const check = limitCheck(s, key, yearTotals(payroll)),
      prior =
        keys.length === 2
          ? Math.max(0, s.employerPlan.retirement.priorDeferrals || 0)
          : 0;
    const cents = (v) => Math.round((Number(v) || 0) * 100);
    let running = 0;
    const points = rows.map((r) => {
      const value = keys.reduce((n, k) => n + cents(r[k]), 0);
      running += value;
      return {
        date: r.date,
        value: value / 100,
        total: running / 100,
        actual: r.source !== "forecast",
        // Spread from a year-to-date total: the timing is a guess.
        estimated: r.source === "history-estimate",
      };
    });
    const done = points.filter((x) => x.actual).at(-1),
      asOf = done?.date ?? null,
      soFar = done?.total ?? 0;
    const future = rows.filter(
      (r) => r.source === "forecast" && (!asOf || r.date > asOf),
    );
    // The other half of a shared limit keeps its current plan.
    const other =
      keys.length === 2
        ? future.reduce(
            (n, r) =>
              n + cents(r[key === "traditional" ? "roth" : "traditional"]),
            0,
          ) / 100
        : 0;
    const room = Math.max(0, check.limit - prior - soFar - other);
    const perCheck = future.length
      ? Math.ceil((room / future.length) * 100 - 1e-6) / 100
      : null;
    const basis = payBasis(s, key);
    const reached = points.findIndex(
      (x) => x.total + prior >= check.limit - 0.005,
    );
    return {
      label: check.label,
      limit: check.limit,
      prior,
      points,
      asOf,
      soFar,
      future: future.length,
      lastDate: points.at(-1)?.date ?? null,
      endTotal: points.at(-1)?.total ?? 0,
      reachDate:
        reached >= 0 && reached < points.length - 1
          ? points[reached].date
          : null,
      perCheck,
      percent:
        perCheck != null && basis.check > 0 ? perCheck / basis.check : null,
    };
  }
  // Payroll elections from a suggestion, except ones the user overrode or set
  // as annual amounts. Returns conflict notes. (applyUpload also copies a
  // percent ESPP election into employerPlan.espp.rate; re-reading elections
  // after a coverage or age change doesn't need that, since the ESPP percent
  // depends on neither.)
  function applyElections(s, suggestion) {
    const conflicts = [];
    for (const [key, election] of Object.entries(suggestion.elections || {})) {
      const existing = s.uploads.elections[key];
      if (s.uploads.annualSettingKeys?.includes(key)) {
        conflicts.push(
          `${key}: kept your annual contribution setting; a payroll election was also observed.`,
        );
      } else if (existing?.manual) {
        if (existing.value !== election.value)
          conflicts.push(
            `${key}: kept your override (${existing.value}); upload suggests ${election.value}.`,
          );
      } else s.uploads.elections[key] = { ...election };
    }
    return conflicts;
  }
  // The user chose to keep their value over this paystub value; later uploads
  // don't offer the same value again (a different value is offered).
  function keepYourValue(s, item) {
    s.uploads.keptDecisions = {
      ...s.uploads.keptDecisions,
      [item.path]: JSON.stringify(item.paystub),
    };
    return s;
  }
  // Replace a kept user value with what the paystub showed (from applyUpload's
  // kept list) and record the paystub as its source again.
  function usePaystubValue(s, item) {
    write(s, item.path, item.paystub);
    s.uploads.manualFields = (s.uploads.manualFields || []).filter(
      (p) => p !== item.path,
    );
    if (s.uploads.confirmedFields) delete s.uploads.confirmedFields[item.path];
    if (s.uploads.keptDecisions) delete s.uploads.keptDecisions[item.path];
    s.uploads.fieldSources ??= {};
    s.uploads.fieldSources[item.path] = item.inferred
      ? { sourceDate: item.sourceDate, basis: item.basis, inferred: true }
      : { sourceDate: item.sourceDate, basis: item.basis };
    return s;
  }
  // Paths the user set or confirmed; uploads and inferences never change them.
  function lockedPaths(s) {
    return [
      ...new Set([
        ...(s.uploads.manualFields || []),
        ...Object.keys(s.uploads.confirmedFields || {}),
      ]),
    ];
  }
  function applyUpload(input, records, suggestion, applySchedule) {
    const S =
      typeof module !== "undefined" && module.exports
        ? require("./scenario")
        : root.Scenario;
    const s = JSON.parse(JSON.stringify(input)),
      defaults = S.defaults(),
      conflicts = [],
      kept = [];
    s.uploads.records = records;
    s.uploads.fieldSources ??= {};
    s.uploads.manualFields ??= [];
    const date = suggestion.record?.date;
    const assign = (
      path,
      value,
      basis,
      sourceDate = date,
      inferred = false,
    ) => {
      if (value == null) return;
      const old = read(s, path),
        prior = s.uploads.fieldSources[path];
      const legacyOverride =
        !prior &&
        old != null &&
        old !== 0 &&
        JSON.stringify(old) !== JSON.stringify(read(defaults, path));
      const confirmed = Object.hasOwn(s.uploads.confirmedFields || {}, path);
      if (
        s.uploads.manualFields.includes(path) ||
        confirmed ||
        legacyOverride
      ) {
        const declined =
          s.uploads.keptDecisions?.[path] === JSON.stringify(value);
        if (JSON.stringify(old) !== JSON.stringify(value) && !declined) {
          conflicts.push(
            `${path}: kept your setting (${old}); upload suggests ${value}.`,
          );
          kept.push({
            path,
            yours: old,
            paystub: value,
            basis,
            sourceDate,
            inferred,
          });
        }
        if (!confirmed)
          s.uploads.manualFields = [
            ...new Set([...s.uploads.manualFields, path]),
          ];
        return;
      }
      write(s, path, value);
      s.uploads.fieldSources[path] = inferred
        ? { sourceDate, basis, inferred: true }
        : { sourceDate, basis };
    };
    for (const [path, { value, basis, sourceDate }] of Object.entries(
      suggestion.inferred || {},
    ))
      assign(path, value, basis, sourceDate || date, true);
    conflicts.push(...applyElections(s, suggestion));
    const v = suggestion.record?.current || {};
    if (v.espp > 0)
      assign("employerPlan.espp.enabled", true, "ESPP deduction on paycheck");
    if (suggestion.elections?.espp?.mode === "percent") {
      assign(
        "employerPlan.espp.rate",
        suggestion.elections.espp.value,
        "Inferred from eligible salary and configured bonus eligibility",
        suggestion.elections.espp.sourceDate,
      );
      if (s.uploads.manualFields.includes("employerPlan.espp.rate")) {
        s.uploads.elections.espp = {
          ...s.uploads.elections.espp,
          value: s.employerPlan.espp.rate,
          mode: "percent",
          manual: true,
        };
      }
    }
    if (v.mega > 0)
      assign(
        "employerPlan.retirement.megaEnabled",
        true,
        "After-tax contribution observed; confirm conversion support",
      );
    const hsaSeen = records.some((r) =>
      ["hsa", "hsaEmployer"].some((k) => r.current?.[k] > 0 || r.ytd?.[k] > 0),
    );
    if (v.hsa > 0 || v.hsaEmployer > 0)
      assign(
        "employerPlan.hsa.eligible",
        true,
        "HSA funding observed; confirm coverage and eligibility",
      );
    // A regular paycheck with no HSA money all year suggests no HSA plan.
    else if (suggestion.record && !hsaSeen)
      assign(
        "employerPlan.hsa.eligible",
        false,
        "No HSA deduction on your paystubs",
        date,
        true,
      );
    const frequency = applySchedule
      ? suggestion.frequency || s.compensation.frequency
      : s.compensation.frequency;
    const count = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 }[
      frequency
    ];
    if (v.employer > 0)
      assign(
        "employerPlan.retirement.employerAnnual",
        v.employer * count,
        "Observed employer funding annualized at the selected pay frequency; not a match formula",
      );
    if (applySchedule) {
      // A guessed schedule makes the salary a guess too.
      const guessed = !!suggestion.frequencyGuessed;
      assign(
        "compensation.salary",
        suggestion.salary,
        "Annualized using the selected pay frequency",
        date,
        guessed,
      );
      assign(
        "compensation.frequency",
        suggestion.frequency,
        suggestion.frequencyBasis || "Inferred from check dates",
        date,
        guessed,
      );
      assign(
        "compensation.firstPayday",
        suggestion.firstPayday,
        "Actual paycheck date",
      );
    }
    s.uploads.useBaseline = true;
    return { scenario: s, conflicts, kept };
  }
  function employerFunding(s, payroll) {
    const latest = [...s.uploads.records]
      .filter(
        (r) =>
          Number(r.date.slice(0, 4)) === s.taxProfile.year &&
          r.ytd?.employer != null,
      )
      .sort((a, b) => a.date.localeCompare(b.date))
      .at(-1);
    const total = payroll?.contributions.employer || 0;
    const remaining = (payroll?.paychecks || [])
      .filter(
        (r) => r.source === "forecast" && (!latest || r.date > latest.date),
      )
      .reduce((n, r) => n + (r.employer || 0), 0);
    return {
      ytd: latest?.ytd.employer ?? null,
      date: latest?.date,
      remaining,
      total,
    };
  }
  // A starting grant that repeats the latest uploaded vest every vesting
  // interval for four years, dated so this year's earlier vests (counted from
  // the YTD total) fall inside it. It is an estimate to edit, not a record.
  function grantFromVests(history) {
    const U =
      typeof module !== "undefined" && module.exports
        ? require("./util")
        : root.Util;
    const latest = history.vests.at(-1);
    if (!latest) return null;
    const interval = history.interval || 3,
      months = 48,
      first = history.vests[0],
      shown = history.vests.reduce((n, v) => n + v.value, 0),
      earlier = Math.max(
        0,
        Math.min(
          Math.floor((months - 1) / interval) - (history.vests.length - 1),
          Math.round((history.ytd - shown) / latest.value),
        ),
      );
    return {
      name: "Estimated from paystubs",
      value: Math.round(((latest.value * months) / interval) * 100) / 100,
      grantPrice: 100,
      vestPrice: 100,
      start: U.addMonths(first.date, -interval * (earlier + 1)),
      months,
      cliff: 0,
      interval,
      saleMode: "cover",
      repeat: false,
      evenVesting: true,
    };
  }
  function grantPreview(g) {
    const E =
      typeof module !== "undefined" && module.exports
        ? require("./equity-schedule")
        : root.EquitySchedule;
    const first = E.vests(g)[0];
    return {
      years: g.months / 12,
      date: first?.date || "Set grant date",
      grantValue: first?.grantValue || 0,
      shares: first?.shares || 0,
      marketValue: first?.value || 0,
    };
  }
  function fieldState(s, path) {
    if (
      s.uploads.manualFields?.includes(path) ||
      (path.startsWith("uploads.elections.") &&
        s.uploads.elections[path.split(".")[2]]?.manual)
    )
      return { kind: "manual", label: "Your setting" };
    if (
      s.uploads.fieldSources?.[path] ||
      (path.startsWith("uploads.elections.") &&
        s.uploads.elections[path.split(".")[2]]?.sourceDate)
    )
      return s.uploads.fieldSources?.[path]?.inferred
        ? Object.hasOwn(s.uploads.confirmedFields || {}, path) &&
          JSON.stringify(s.uploads.confirmedFields[path]) ===
            JSON.stringify(read(s, path))
          ? { kind: "confirmed", label: "Confirmed" }
          : {
              kind: "inferred",
              label: "Inferred",
              basis: s.uploads.fieldSources[path].basis,
            }
        : { kind: "observed", label: "From paystub" };
    if (
      Object.hasOwn(s.uploads.confirmedFields || {}, path) &&
      JSON.stringify(s.uploads.confirmedFields[path]) ===
        JSON.stringify(read(s, path))
    )
      return { kind: "confirmed", label: "Confirmed" };
    const required = [
      "taxProfile.age",
      "taxProfile.settings.filing",
      "taxProfile.settings.state",
      "compensation.salary",
      "compensation.frequency",
    ];
    if (s.employerPlan.espp.enabled)
      required.push(
        ...[
          "start",
          "periodMonths",
          "discount",
          "lookback",
          "offerPrice",
          "purchasePrice",
          "bonusEligible",
        ].map((k) => "employerPlan.espp." + k),
      );
    if (s.employerPlan.hsa.eligible)
      required.push(
        "employerPlan.hsa.coverage",
        "employerPlan.hsa.eligibleMonths",
      );
    if (required.includes(path) || path.startsWith("compensation.grants."))
      return {
        kind: "review",
        label:
          read(s, path) == null ||
          read(s, path) === "" ||
          (path === "compensation.salary" && !read(s, path))
            ? "Needs input"
            : "Confirm assumption",
      };
    return { kind: "optional", label: "Optional / default" };
  }
  function confirm(s, path) {
    const value = read(s, path);
    if (
      value == null ||
      value === "" ||
      fieldState(s, path).label === "Needs input"
    )
      throw new Error("Enter a value before confirming.");
    s.uploads.confirmedFields ??= {};
    s.uploads.confirmedFields[path] = JSON.parse(JSON.stringify(value));
  }
  function displayValue(value, type) {
    if (value == null) return "";
    if (type === "years") return value / 12;
    if (type === "percent") return (value * 100).toFixed(1);
    if (type === "number") return Number(value).toFixed(2);
    return value;
  }
  // The share price slider: Scenario.sharePrice with a range of 0.25x to 3x
  // the reference, so dragging never moves its own bounds. Null without equity.
  function sharePrice(s) {
    const S =
      typeof module !== "undefined" && module.exports
        ? require("./scenario")
        : root.Scenario;
    const p = S.sharePrice(s);
    if (!p) return null;
    const cents = (v) => Math.round(v * 100) / 100;
    return {
      ...p,
      min: cents(p.reference * 0.25),
      max: cents(p.reference * 3),
    };
  }
  const api = {
    sharePrice,
    limitPlan,
    yearTotals,
    limitCheck,
    amountUnits,
    equivalents,
    setElection,
    describe,
    hasIncome,
    initialView,
    applyUpload,
    lockedPaths,
    usePaystubValue,
    keepYourValue,
    applyElections,
    edit,
    employerFunding,
    grantPreview,
    grantFromVests,
    fieldState,
    confirm,
    displayValue,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Profile = api;
})(typeof window !== "undefined" ? window : globalThis);
