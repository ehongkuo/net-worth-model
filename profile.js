(function (root) {
  "use strict";
  function describe(s) {
    const records = [...s.uploads.records]
        .filter((r) => (r.kind || "regular") === "regular")
        .sort((a, b) => a.date.localeCompare(b.date)),
      last = records.at(-1),
      prior = records.at(-2),
      v = last?.current || {};
    const gap = prior
      ? (Date.parse(last.date) - Date.parse(prior.date)) / 86400000
      : 0;
    const frequency =
        gap === 14
          ? "biweekly"
          : gap === 7
            ? "weekly"
            : s.compensation.frequency,
      confirmed = gap === 14 || gap === 7,
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
  function edit(s, path, value) {
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
    for (const [path, { value, basis }] of Object.entries(
      suggestion.inferred || {},
    ))
      assign(path, value, basis, date, true);
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
    if (v.hsa > 0 || v.hsaEmployer > 0)
      assign(
        "employerPlan.hsa.eligible",
        true,
        "HSA funding observed; confirm coverage and eligibility",
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
      assign(
        "compensation.salary",
        suggestion.salary,
        "Annualized using the selected pay frequency",
      );
      assign(
        "compensation.frequency",
        suggestion.frequency,
        "Inferred from check dates",
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
      "compensation.firstPayday",
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
  const api = {
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
    fieldState,
    confirm,
    displayValue,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Profile = api;
})(typeof window !== "undefined" ? window : globalThis);
