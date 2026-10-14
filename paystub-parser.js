(function (root) {
  "use strict";
  const labels = {
    salary: "Base salary",
    bonus: "Bonus",
    allowance: "Cash allowance (not taxable)",
    imputed: "Noncash taxable benefit",
    traditional: "Traditional 401(k)",
    roth: "Roth 401(k)",
    mega: "After-tax mega contribution",
    hsa: "Employee HSA",
    health: "Pre-tax benefits",
    post: "Post-tax expense",
    espp: "ESPP funding",
    employer: "Employer retirement",
    hsaEmployer: "Employer HSA",
    employerMedical: "Employer medical benefit",
    federal: "Federal withheld",
    state: "State withheld",
    ss: "Social Security",
    medicare: "Medicare",
    sdi: "State disability",
    taxablePayroll: "Payroll taxable wages",
    taxableMedicare: "Medicare taxable wages",
    taxableFederal: "Federal taxable wages",
    ignore: "Exclude from forecast",
  };
  const benefitTypes = {
    health: { label: "Pre-tax coverage / services", field: "health" },
    fsa: { label: "Healthcare FSA", field: "health" },
    dependentCare: { label: "Dependent-care FSA", field: "health" },
    commuter: { label: "Transit funds", field: "health" },
    parking: { label: "Parking funds", field: "health" },
    post: { label: "Post-tax coverage / services", field: "post" },
    restrictedPost: { label: "Post-tax restricted funds", field: "post" },
    allowance: { label: "Nontaxable cash reimbursement", field: "allowance" },
    taxableAllowance: {
      label: "Taxable cash allowance",
      field: "taxableAllowance",
    },
    imputed: { label: "Taxable noncash benefit", field: "imputed" },
    employerMedical: {
      label: "Employer-paid coverage / direct service",
      field: "employerMedical",
    },
  };
  Object.entries(benefitTypes).forEach(
    ([key, type]) => (labels[key] = type.label),
  );
  const MIN_TAX_YEAR = 2026; // first year the tax engine models
  const NO_INCOME_TAX = ["AK", "FL", "NV", "NH", "SD", "TN", "TX", "WA", "WY"];
  const STATES =
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(
      " ",
    );
  // The last valid USPS code in a label: "ST WH CA" -> CA, "OR State Income Tax" -> OR.
  const stateCode = (label) =>
    (label.match(/\b[A-Z]{2}\b/g) || [])
      .filter((t) => STATES.includes(t))
      .at(-1) || (/california/i.test(label) ? "CA" : "");
  const parseMoney = (s) =>
    Number(String(s).replace(/[$,()]/g, "")) *
    (String(s).includes("(") ? -1 : 1);
  const total = (o, keys) =>
    Math.round(keys.reduce((n, k) => n + (o[k] || 0), 0) * 100) / 100;
  const usDateToIso = (s) => {
    const [m, d, y] = s.split("/");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  };
  function mapping(label, section) {
    if (section === "Taxable Wages")
      return /Federal/i.test(label)
        ? "taxableFederal"
        : /Medicare/i.test(label)
          ? "taxableMedicare"
          : /OASDI|Social Security/i.test(label)
            ? "taxablePayroll"
            : null;
    if (section === "Employer Paid Benefits")
      return /HSA/i.test(label)
        ? "hsaEmployer"
        : /401|match|retirement/i.test(label)
          ? "employer"
          : /medical/i.test(label)
            ? "employerMedical"
            : null;
    if (section === "Employee Taxes")
      return /OASDI|Social Security/i.test(label)
        ? "ss"
        : /Medicare/i.test(label)
          ? "medicare"
          : /Federal/i.test(label)
            ? "federal"
            : /SDI|disability|\bSUI\b|\bPFL\b|\bFLI\b|family leave|unemploy/i.test(
                  label,
                )
              ? "sdi"
              : /state\s+(income\s+)?tax|state\s+withholding|\bSIT\b|\bST\s+WH\b|withholding/i.test(
                    label,
                  )
                ? "state"
                : null;
    if (section === "Earnings")
      return /imputed/i.test(label)
        ? "imputed"
        : /regular salary|base salary|regular pay/i.test(label)
          ? "salary"
          : /bonus/i.test(label)
            ? "bonus"
            : /connectivity allowance/i.test(label)
              ? "allowance"
              : null;
    if (/mega|after.tax.*401|401.*after.tax/i.test(label)) return "mega";
    if (/401.*roth|roth.*401/i.test(label)) return "roth";
    if (/401.*pre.tax|traditional.*401/i.test(label)) return "traditional";
    if (/HSA/i.test(label)) return "hsa";
    if (/ESPP/i.test(label)) return "espp";
    if (section === "Pre Tax Deductions") {
      if (/dependent.*care/i.test(label)) return "dependentCare";
      if (/FSA|flex.*spend/i.test(label)) return "fsa";
      if (/parking/i.test(label)) return "parking";
      if (/transit|commut/i.test(label)) return "commuter";
      if (/medical|dental|vision/i.test(label)) return "health";
    }
    if (section === "Post Tax Deductions" && /gym/i.test(label)) return "post";
    return null;
  }
  function parse(pages, existing = []) {
    const result = {
      version: 1,
      date: "",
      kind: "regular",
      current: {},
      ytd: {},
      lines: [],
      netPay: 0,
      summary: {},
      periodStart: "",
      periodEnd: "",
    };
    let section = "";
    for (const page of pages)
      for (const raw of page.text.split("\n")) {
        const line = raw.trim();
        // Some layouts print the W-4 filing status ("Marital Status: Single").
        const filing = line.match(
          /(?:filing|marital)\s+status\W+(single|married(?! filing separ)|head of household)/i,
        );
        if (filing && !result.filingStatus)
          result.filingStatus = /married/i.test(filing[1])
            ? "married"
            : /single/i.test(filing[1])
              ? "single"
              : "";
        const dates = line.match(/\d{2}\/\d{2}\/\d{4}/g);
        if (dates?.length >= 3 && !result.date) {
          [result.periodStart, result.periodEnd, result.date] = dates
            .slice(-3)
            .map(usDateToIso);
        }
        if (
          [
            "Earnings",
            "Employee Taxes",
            "Pre Tax Deductions",
            "Post Tax Deductions",
            "Employer Paid Benefits",
            "Taxable Wages",
          ].includes(line)
        ) {
          section = line;
          continue;
        }
        if (
          /^(Withholding|Absence Plans|Payment Information|Current and YTD Totals)$/.test(
            line,
          )
        ) {
          section = "";
          continue;
        }
        const numbers = [...line.matchAll(/-?\$?\(?\d[\d,]*\.\d{2}\)?/g)];
        if (/^(Current|YTD)\s/.test(line) && numbers.length >= 6) {
          const values = numbers.slice(-5).map((m) => parseMoney(m[0]));
          const target = line.startsWith("Current") ? "current" : "ytd";
          result.summary[target] = Object.fromEntries(
            ["gross", "pretax", "taxes", "posttax", "net"].map((k, i) => [
              k,
              values[i],
            ]),
          );
          if (target === "current") result.netPay = values[4];
          continue;
        }
        if (!section || !numbers.length || /^Total:|^Description|^©/.test(line))
          continue;
        const label = line
          .slice(0, numbers[0].index)
          .replace(/\d{2}\/\d{2}\/\d{4}.*$/, "")
          .trim();
        if (!label || /^\d{2}\/|^Page/.test(label)) continue;
        const values = numbers.slice(-2).map((m) => parseMoney(m[0]));
        result.lines.push({
          label,
          section,
          key: mapping(label, section),
          current: values.length > 1 ? values[0] : null,
          ytd: values.at(-1),
          page: page.page,
        });
      }
    const previous = benefitPlans(existing);
    for (const line of result.lines) {
      const known = previous.find(
        (b) => b.id === line.section + ":" + line.label,
      );
      if (known) {
        line.key = known.category;
        line.schedule = known.schedule;
        line.annualCap = known.annualCap;
      }
    }
    return rebuild(result);
  }
  function rebuild(record) {
    record.current = {};
    record.ytd = {};
    record.benefits = [];
    for (const line of record.lines) {
      if (!line.key || line.key === "ignore") continue;
      const type = benefitTypes[line.key],
        key = type?.field || line.key;
      for (const period of ["current", "ytd"])
        if (line[period] != null || period === "current")
          record[period][key] = total(
            { a: record[period][key], b: line[period] },
            ["a", "b"],
          );
      if (type)
        record.benefits.push({
          id: line.section + ":" + line.label,
          label: line.label,
          category: line.key,
          current: line.current,
          ytd: line.ytd,
          annualCap: line.annualCap ?? null,
          schedule:
            line.schedule ||
            (["commuter", "parking"].includes(line.key)
              ? "review"
              : "paycheck"),
        });
    }
    return record;
  }
  function validate(r) {
    const errors = [];
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(r.date) ||
      !Number.isFinite(Date.parse(r.date)) ||
      new Date(r.date).toISOString().slice(0, 10) !== r.date
    )
      errors.push("Confirm the check date.");
    if (!r.summary?.current)
      errors.push(
        "Current payroll totals were not found. This layout needs manual review.",
      );
    if (r.benefits?.some((b) => b.schedule === "review"))
      errors.push("Confirm the schedule for restricted benefit deductions.");
    if (r.lines.some((l) => !l.key)) errors.push("Map all unrecognized lines.");
    if (r.lines.some((l) => (l.current || 0) < 0))
      errors.push(
        "Negative adjustments require a corrected regular statement; this importer does not yet forecast reversals.",
      );
    const current = r.current || {},
      gross = total(current, [
        "salary",
        "bonus",
        "allowance",
        "taxableAllowance",
      ]),
      pretax = total(current, ["traditional", "hsa", "health"]),
      taxes = total(current, ["federal", "state", "ss", "medicare", "sdi"]),
      posttax = total(current, ["roth", "mega", "espp", "post"]);
    const computed = {
      gross,
      pretax,
      taxes,
      posttax,
      net: Math.round((gross - pretax - taxes - posttax) * 100) / 100,
    };
    for (const k of Object.keys(computed))
      if (
        r.summary?.current &&
        Math.abs(
          computed[k] - (k === "net" ? r.netPay : r.summary.current[k]),
        ) > 0.011
      )
        errors.push(`${k} does not reconcile to the printed total.`);
    if (r.summary?.ytd) {
      const y = r.ytd || {},
        gross = total(y, ["salary", "bonus", "allowance", "taxableAllowance"]),
        pretax = total(y, ["traditional", "hsa", "health"]),
        taxes = total(y, ["federal", "state", "ss", "medicare", "sdi"]),
        posttax = total(y, ["roth", "mega", "espp", "post"]);
      const computedYtd = {
        gross,
        pretax,
        taxes,
        posttax,
        net: Math.round((gross - pretax - taxes - posttax) * 100) / 100,
      };
      for (const [key, value] of Object.entries(computedYtd))
        if (Math.abs(value - r.summary.ytd[key]) > 0.011)
          errors.push(`YTD ${key} does not reconcile to the printed total.`);
    }
    return { valid: errors.length === 0, errors, computed };
  }
  function mergeRecords(existing, incoming) {
    const out = [...existing];
    for (const r of incoming) {
      const same = out.find((x) => x.date === r.date && x.kind === r.kind);
      if (same) {
        if (
          JSON.stringify(same.current) !== JSON.stringify(r.current) ||
          JSON.stringify(same.ytd) !== JSON.stringify(r.ytd) ||
          same.netPay !== r.netPay
        )
          throw new Error(
            `A different ${r.kind} check already exists on ${r.date}. Remove the old record before importing a correction.`,
          );
        continue;
      }
      out.push(r);
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }
  function suggest(records, c, { locked = [], today = new Date() } = {}) {
    const tax =
      typeof module !== "undefined" && module.exports
        ? require("./tax-engine")
        : root.TaxEngine;
    const sorted = [...records]
        .filter((r) => (r.kind || "regular") === "regular")
        .sort((a, b) => a.date.localeCompare(b.date)),
      last = sorted.at(-1);
    if (!last) return {};
    const gap =
      sorted.length > 1
        ? (Date.parse(last.date) - Date.parse(sorted.at(-2).date)) / 86400000
        : 0;
    const frequency =
      gap === 14 ? "biweekly" : gap === 7 ? "weekly" : c.frequency;
    const count = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 }[
      frequency
    ];
    // Per-check amounts are rounded to cents, so salary × checks lands a few
    // cents off the real annual figure; snap to $10 when rounding explains it.
    const rawSalary = last.current.salary * count,
      snapped = Math.round(rawSalary / 10) * 10,
      salary =
        Math.abs(snapped - rawSalary) <= count * 0.01 ? snapped : rawSalary,
      elections = {},
      inferred = {},
      warnings = [];
    // Never infer over a value the user set or confirmed.
    const infer = (path, value, basis) => {
      if (!locked.includes(path)) inferred[path] = { value, basis };
    };
    const year = Number(last.date.slice(0, 4));
    // Only a check from the current calendar year describes the year being
    // modeled; older checks (e.g. last December's) never move the tax year.
    if (year === today.getFullYear() && year >= MIN_TAX_YEAR)
      infer("taxProfile.year", year, "Year of your latest check date");
    // A W-4 withholding status is a starting guess for the filing status.
    const filing = sorted.findLast((r) => r.filingStatus)?.filingStatus;
    if (filing)
      infer(
        "taxProfile.settings.filing",
        filing,
        "Withholding status printed on your paystub",
      );
    // State: only a recognized state income tax line names it. An unrecognized
    // or missing line is never read as "no state income tax".
    const stateLine = (last.lines || []).find((l) => l.key === "state");
    const code = stateCode(stateLine?.label || "");
    if (code === "CA")
      infer(
        "taxProfile.settings.state",
        "CA",
        `Withholding line "${stateLine.label}"`,
      );
    else if (code && NO_INCOME_TAX.includes(code))
      infer(
        "taxProfile.settings.state",
        "none",
        `${code} has no state income tax`,
      );
    else if (code) {
      infer(
        "taxProfile.settings.state",
        "custom",
        `Withholding line "${stateLine.label}"`,
      );
      // State withholding also covers bonus and RSU income.
      const wages =
        (last.ytd.salary || 0) + (last.ytd.bonus || 0) + (last.ytd.rsu || 0);
      if (wages > 0 && last.ytd.state > 0)
        infer(
          "taxProfile.settings.customStateRate",
          Math.round((last.ytd.state / wages) * 10000) / 10000,
          "Estimated from state tax withheld this year; adjust if you know your effective rate",
        );
    }
    // HSA coverage: only year-to-date funding proves the coverage type. A
    // per-check rate can be front-loaded or a one-time deposit, and a payroll
    // system stops self-only funding at the cap. Without a known age under 55
    // the $1,000 catch-up must also be exceeded.
    const ytdHsa = (last.ytd.hsa || 0) + (last.ytd.hsaEmployer || 0);
    if (ytdHsa > 0) {
      const l = tax.limits(year, c.tax),
        ageKnown = locked.includes("taxProfile.age"),
        catchup = ageKnown && c.age + year - c.taxYear < 55 ? 0 : l.hsaCatchup;
      if (ytdHsa > l.hsaFamily + l.hsaCatchup + 0.01)
        warnings.push(
          "HSA funding this year is above the family limit; check the HSA lines.",
        );
      else if (ytdHsa > l.hsaSingle + catchup + 0.01)
        infer(
          "employerPlan.hsa.coverage",
          "family",
          `HSA funding so far this year (${Math.round(ytdHsa).toLocaleString("en-US")}) is above the ${(l.hsaSingle + catchup).toLocaleString("en-US")} self-only limit`,
        );
    }
    // Bonus: only an annual or performance bonus recurs; sign-on, spot and
    // retention bonuses are one-time.
    const recurringBonus = (r) =>
      (r.lines || []).some(
        (l) =>
          l.key === "bonus" &&
          l.current > 0 &&
          /annual|performance|target|incentive/i.test(l.label),
      );
    const bonusCheck = sorted.findLast(recurringBonus);
    if (bonusCheck && salary > 0) {
      infer(
        "compensation.bonusMonth",
        Number(bonusCheck.date.slice(5, 7)),
        `Bonus paid on ${bonusCheck.date}`,
      );
      infer(
        "compensation.bonusPercent",
        Math.round((bonusCheck.current.bonus / salary) * 1000) / 1000,
        `Bonus on ${bonusCheck.date} relative to salary`,
      );
    }
    const capped = (record, key) => {
      const year = Number(record.date.slice(0, 4)),
        l = tax.limits(year, c.tax),
        age = c.age + year - c.taxYear,
        y = record.ytd || {},
        r = c.retirement;
      const deferral =
        l.deferral +
        (age >= 60 && age <= 63 ? l.superCatchup : age >= 50 ? l.catchup : 0);
      const caps = {
        traditional: deferral,
        roth: deferral,
        mega: Math.min(
          r.megaAnnualCap ?? Infinity,
          Math.max(
            0,
            l.total401k -
              Math.min(l.deferral, (y.traditional || 0) + (y.roth || 0)) -
              (y.employer || 0),
          ),
        ),
        hsa: Math.max(
          0,
          (((coverage === "family" ? l.hsaFamily : l.hsaSingle) +
            (age >= 55 ? l.hsaCatchup : 0)) *
            Math.min(12, c.hsa.eligibleMonths)) /
            12 -
            (y.hsaEmployer || 0),
        ),
        espp: c.espp.annualPayrollCap || Infinity,
      };
      const used = ["traditional", "roth"].includes(key)
        ? (y.traditional || 0) + (y.roth || 0)
        : y[key];
      return used != null && used >= caps[key] - 0.02;
    };
    const coverage =
      inferred["employerPlan.hsa.coverage"]?.value || c.hsa.coverage;
    for (const key of [
      "traditional",
      "roth",
      "mega",
      "espp",
      "hsa",
      "health",
      "post",
      "imputed",
      "allowance",
      "taxableAllowance",
    ]) {
      let source = last;
      if (capped(last, key)) {
        source = sorted
          .slice(0, -1)
          .reverse()
          .find((r) => r.current[key] > 0 && !capped(r, key));
        if (!source) {
          if (c.payroll?.elections?.[key])
            elections[key] = c.payroll.elections[key];
          else
            warnings.push(
              `${labels[key]} is already capped; existing annual settings remain until an uncapped election is supplied.`,
            );
          continue;
        }
      }
      if (source.current[key] == null) continue;
      const percent = ["traditional", "roth", "mega", "espp"].includes(key);
      const bonusEligible =
        key === "espp" ? c.espp.bonusEligible : c.retirement.bonusEligible;
      const basis =
        (source.current.salary || 0) +
        (bonusEligible ? source.current.bonus || 0 : 0);
      if (percent && basis <= 0) {
        warnings.push(
          `${labels[key]} has no eligible pay basis; confirm the election.`,
        );
        continue;
      }
      elections[key] = {
        mode: percent ? "percent" : "fixed",
        value: percent
          ? source.current[key] / Math.max(0.01, basis)
          : source.current[key],
        sourceDate: source.date,
      };
    }
    const v = last.current,
      withholding = {};
    if (v.taxableFederal > 0 && v.federal != null)
      withholding.federal = {
        rate: v.federal / v.taxableFederal,
        basis: "Federal taxable wages",
        sourceDate: last.date,
      };
    if (v.salary + (v.bonus || 0) > 0 && v.state != null)
      withholding.state = {
        rate: v.state / (v.salary + (v.bonus || 0)),
        basis: "Gross salary and bonus (state wage basis unavailable)",
        sourceDate: last.date,
      };
    return {
      salary: Math.abs(salary - c.salary) < 1 ? c.salary : salary,
      frequency,
      firstPayday: last.date,
      elections,
      inferred,
      withholding,
      warnings,
      record: last,
    };
  }
  function benefitPlans(records) {
    const plans = new Map();
    for (const record of [...records].sort((a, b) =>
      a.date.localeCompare(b.date),
    ))
      for (const b of record.benefits || []) {
        if (!benefitTypes[b.category]) continue;
        const previous = plans.get(b.id);
        const current =
          b.schedule === "monthly" && !(b.current > 0) && previous
            ? previous.current
            : b.current;
        plans.set(b.id, {
          ...b,
          current: current ?? previous?.current ?? 0,
          sourceDate: record.date,
        });
      }
    return [...plans.values()];
  }
  const api = {
    benefitTypes,
    benefitPlans,
    parse,
    rebuild,
    validate,
    mergeRecords,
    suggest,
    labels,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PaystubParser = api;
})(typeof window !== "undefined" ? window : globalThis);
