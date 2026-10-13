(function (root) {
  "use strict";
  const C =
    typeof module !== "undefined" && module.exports
      ? require("./compensation")
      : root.Compensation;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const pick = (value, keys) =>
    Object.fromEntries(
      keys
        .filter((k) => value?.[k] !== undefined)
        .map((k) => [k, clone(value[k])]),
    );
  const compensationKeys = [
    "salary",
    "salaryGrowth",
    "stockGrowth",
    "bonusPercent",
    "bonusMonth",
    "frequency",
    "firstPayday",
    "grants",
  ];
  const retirementKeys = [
    "traditional",
    "roth",
    "mega",
    "megaEnabled",
    "megaAnnualCap",
    "employerAnnual",
    "matchRate",
    "matchPercent",
    "matchTrueUp",
    "bonusEligible",
    "rsuEligible",
    "contributionGrowth",
    "priorDeferrals",
    "priorEmployer",
    "priorAfterTax",
    "ira",
    "iraMode",
    "iraPretaxBalance",
    "iraBasis",
    "conversionDelayMonths",
    "priorYearWages",
    "maxIra",
    "max401k",
    "maxMega",
  ];
  const hsaKeys = [
    "eligible",
    "coverage",
    "employee",
    "employer",
    "payroll",
    "eligibleMonths",
    "prior",
    "maxContribution",
  ];
  const esppKeys = [
    "enabled",
    "qualifiedPlan",
    "rate",
    "bonusEligible",
    "discount",
    "lookback",
    "offerPrice",
    "purchasePrice",
    "salePrice",
    "periodMonths",
    "start",
    "holdMonths",
    "holdShares",
    "shareCap",
    "annualFmvLimit",
    "annualPayrollCap",
    "fractional",
    "fee",
    "autoEnroll",
    "firstEnrollmentDate",
    "enrollments",
    "employmentStart",
    "employmentEnd",
    "minRate",
    "maxRate",
    "stopAtAnnualLimit",
    "payrollRounding",
    "reserveFutureTax",
    "reserveSaleMonths",
    "end",
  ];
  const grantKeys = [
    "name",
    "value",
    "grantPrice",
    "vestPrice",
    "start",
    "months",
    "cliff",
    "interval",
    "saleMode",
    "sell",
    "repeat",
    "ticker",
    "evenVesting",
    "annualAllocations",
  ];
  const payrollFields = [
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
    "employerMedical",
    "federal",
    "state",
    "ss",
    "medicare",
    "sdi",
    "taxablePayroll",
    "taxableMedicare",
    "taxableFederal",
  ];
  const validDate = (v) =>
    /^\d{4}-\d{2}-\d{2}$/.test(v || "") &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v;
  const recordKeys = [
    "id",
    "date",
    "kind",
    "periodStart",
    "periodEnd",
    "current",
    "ytd",
    "netPay",
    "benefits",
  ];
  const accountKeys = [
    "cash",
    "brokerage",
    "pretax401k",
    "rothAccounts",
    "traditionalIRA",
    "hsa",
  ];
  const expenseKeys = [
    "housing",
    "dining",
    "groceries",
    "giving",
    "travel",
    "entertainment",
    "auto",
    "other",
  ];
  function defaults() {
    const c = C.defaults();
    return {
      schemaVersion: 3,
      taxProfile: {
        year: c.taxYear,
        age: c.age,
        birthday: "",
        settings: c.tax,
      },
      employerPlan: {
        retirement: c.retirement,
        hsa: c.hsa,
        benefits: c.benefits,
        espp: c.espp,
      },
      compensation: pick(c, compensationKeys),
      uploads: {
        records: [],
        elections: {},
        bonusDate: "",
        useBaseline: true,
        annualSettingKeys: [],
      },
      projection: {
        years: 40,
        retirementAge: 65,
        inflation: 0.02,
        marketReturn: 0.08,
        socialSecurityAnnual: 0,
        socialSecurityStartAge: 67,
        startingBalances: Object.fromEntries(accountKeys.map((k) => [k, 0])),
        monthlyExpenses: Object.fromEntries(expenseKeys.map((k) => [k, 0])),
      },
    };
  }
  function normalize(input) {
    if (!input || input.schemaVersion !== 3)
      throw new Error(
        "Expected a version 3 scenario. Use the legacy importer for older exports.",
      );
    const finite = (v) => {
      if (typeof v === "number" && !Number.isFinite(v))
        throw new Error("Scenario numbers must be finite.");
      if (v && typeof v === "object") Object.values(v).forEach(finite);
    };
    finite(input);
    const d = defaults(),
      m = C.merge(d, input),
      t = m.taxProfile,
      p = m.employerPlan,
      u = m.uploads;
    const scenario = {
      schemaVersion: 3,
      taxProfile: {
        year: t.year,
        age: t.age,
        birthday: t.birthday || "",
        settings: pick(t.settings, [
          ...Object.keys(d.taxProfile.settings),
          "rsuCoverRate",
        ]),
      },
      employerPlan: {
        retirement: pick(p.retirement, retirementKeys),
        hsa: pick(p.hsa, hsaKeys),
        benefits: pick(p.benefits, Object.keys(d.employerPlan.benefits)),
        espp: pick(p.espp, esppKeys),
      },
      compensation: pick(m.compensation, compensationKeys),
      uploads: {
        records: (u.records || []).map((r) => ({
          ...pick(r, recordKeys),
          current: pick(r.current, payrollFields),
          ytd: pick(r.ytd, payrollFields),
          benefits: (r.benefits || []).map((b) =>
            pick(b, [
              "id",
              "label",
              "category",
              "current",
              "ytd",
              "schedule",
              "annualCap",
            ]),
          ),
        })),
        elections: {},
        manualFields: (u.manualFields || []).filter(
          (x) => typeof x === "string",
        ),
        confirmedFields: clone(u.confirmedFields || {}),
        fieldSources: Object.fromEntries(
          Object.entries(u.fieldSources || {}).map(([k, v]) => [
            k,
            pick(v, ["sourceDate", "basis"]),
          ]),
        ),
        bonusDate: u.bonusDate || "",
        useBaseline: u.useBaseline !== false,
        annualSettingKeys: (u.annualSettingKeys || []).filter((k) =>
          [
            "traditional",
            "roth",
            "mega",
            "hsa",
            "espp",
            "health",
            "post",
          ].includes(k),
        ),
      },
      projection: pick(m.projection, Object.keys(d.projection)),
    };
    for (const record of scenario.uploads.records)
      for (const b of record.benefits) {
        if (!["paycheck", "monthly", "once", "review"].includes(b.schedule))
          throw new Error("Choose a valid benefit schedule.");
        if (
          b.annualCap != null &&
          (typeof b.annualCap !== "number" || b.annualCap < 0)
        )
          throw new Error("Benefit caps must be nonnegative.");
      }
    scenario.compensation.grants = (m.compensation.grants || []).map((g) => ({
      ...{
        name: "RSU grant",
        grantPrice: 100,
        vestPrice: g.grantPrice || 100,
        start: `${t.year}-01-01`,
        months: 48,
        cliff: 0,
        interval: 3,
        saleMode: C.rsuMode(g),
        repeat: false,
        evenVesting: true,
      },
      ...pick(g, grantKeys),
    }));
    for (const grant of scenario.compensation.grants) C.grantAllocations(grant);
    for (const [key, value] of Object.entries(u.elections || {}))
      if (
        [
          "traditional",
          "roth",
          "mega",
          "hsa",
          "espp",
          "health",
          "post",
          "imputed",
          "allowance",
        ].includes(key)
      )
        scenario.uploads.elections[key] = pick(value, [
          "mode",
          "value",
          "sourceDate",
          "manual",
        ]);
    scenario.projection.startingBalances = pick(
      m.projection.startingBalances,
      accountKeys,
    );
    scenario.projection.monthlyExpenses = pick(
      m.projection.monthlyExpenses,
      expenseKeys,
    );
    if (!Number.isInteger(t.year) || t.year < 2026 || t.year > 2200)
      throw new Error("Tax year must be 2026 through 2200.");
    if (!Number.isFinite(t.age) || t.age < 0 || t.age > 120)
      throw new Error("Age must be 0 through 120.");
    if (
      !Number.isInteger(m.projection.years) ||
      m.projection.years < 1 ||
      m.projection.years > 100 ||
      t.year + m.projection.years > 2201
    )
      throw new Error("Projection must cover 1 through 100 supported years.");
    if (
      !["weekly", "biweekly", "semimonthly", "monthly"].includes(
        scenario.compensation.frequency,
      )
    )
      throw new Error("Choose a supported pay frequency.");
    if (!validDate(scenario.compensation.firstPayday))
      throw new Error("Enter a valid payday anchor.");
    for (const key of ["inflation", "marketReturn"])
      if (!Number.isFinite(m.projection[key]) || m.projection[key] <= -1)
        throw new Error(`${key} must exceed -100%.`);
    const checkTypes = (value, template, path) => {
      for (const [key, base] of Object.entries(template)) {
        const v = value[key];
        if (
          typeof base === "number" &&
          (typeof v !== "number" || !Number.isFinite(v))
        )
          throw new Error(`Enter a number for ${path}.${key}.`);
        if (base && typeof base === "object" && !Array.isArray(base))
          checkTypes(v, base, `${path}.${key}`);
      }
    };
    checkTypes(scenario, d, "scenario");
    if (!["single", "married"].includes(t.settings.filing))
      throw new Error(
        "Supported filing statuses are single and married filing jointly.",
      );
    if (!["none", "CA", "custom"].includes(t.settings.state))
      throw new Error("Choose a supported state tax model.");
    const positive = (v, label) => {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0)
        throw new Error(`${label} must be a nonnegative amount.`);
    };
    positive(scenario.compensation.salary, "Salary");
    for (const values of [
      scenario.projection.startingBalances,
      scenario.projection.monthlyExpenses,
    ])
      for (const [key, v] of Object.entries(values)) positive(v, key);
    if (
      !Number.isInteger(scenario.compensation.bonusMonth) ||
      scenario.compensation.bonusMonth < 1 ||
      scenario.compensation.bonusMonth > 12
    )
      throw new Error("Bonus month must be 1 through 12.");
    for (const r of scenario.uploads.records) {
      if (!validDate(r.date)) throw new Error("Invalid paycheck date.");
      for (const values of [r.current, r.ytd])
        for (const [key, v] of Object.entries(values)) positive(v, key);
    }
    for (const [key, e] of Object.entries(scenario.uploads.elections)) {
      if (!["fixed", "percent"].includes(e.mode))
        throw new Error("Invalid election mode.");
      positive(e.value, key);
      if (e.mode === "percent" && e.value > 1)
        throw new Error("Contribution rates cannot exceed 100%.");
    }
    for (const g of scenario.compensation.grants) {
      if (!validDate(g.start) || !(g.months > 0) || !(g.grantPrice > 0))
        throw new Error(
          "Grants need a valid date, duration and positive grant price.",
        );
      positive(g.value, "Grant value");
    }
    const checkFinite = (v, path) => {
      if (typeof v === "number" && !Number.isFinite(v))
        throw new Error(`Invalid number at ${path}.`);
      if (v && typeof v === "object")
        Object.entries(v).forEach(([k, x]) => checkFinite(x, `${path}.${k}`));
    };
    checkFinite(scenario, "scenario");
    return scenario;
  }
  function fromLegacy(cfg) {
    if (cfg.compensation?.version === 2)
      return C.merge(C.defaults(), cfg.compensation);
    return C.merge(C.defaults(), {
      salary: cfg.baseSalary ?? 165000,
      age: cfg.age ?? 25,
      salaryGrowth: cfg.salaryGrowth ?? 0.03,
      bonusPercent: cfg.bonusPercent ?? 0.1,
      tax: {
        spouseIncome: cfg.spouseIncome || 0,
        otherIncome: cfg.rentalIncome || 0,
      },
      retirement: {
        traditional: cfg.pretax401k || 0,
        mega: cfg.megaBackdoor || 0,
        megaEnabled: !!cfg.megaBackdoor,
        ira: cfg.rothIRA || 0,
        iraPretaxBalance: cfg.traditionalIRA || 0,
      },
      hsa: { employee: cfg.hsaContrib || 0 },
      grants: cfg.rsuAnnualGross
        ? [
            {
              name: "Existing annual RSU estimate",
              value: cfg.rsuAnnualGross,
              grantPrice: 100,
              vestPrice: 100,
              start: "2025-12-31",
              months: 12,
              cliff: 0,
              interval: 3,
              sell: true,
              repeat: true,
            },
          ]
        : [],
    });
  }
  function migrate(input) {
    if (input?.schemaVersion === 3)
      return { scenario: normalize(input), warnings: [] };
    if (!input?.config)
      throw new Error("This file is not a supported scenario.");
    const v = input.config,
      c = fromLegacy(v),
      d = defaults(),
      warnings = [];
    if (v.compensation?.version !== 2) c.retirement.iraPretaxBalance = 0;
    if (input.events?.length)
      warnings.push(
        `${input.events.length} legacy life events are excluded from this simplified model. The original export is kept as a backup.`,
      );
    const s = {
      ...d,
      taxProfile: {
        year: c.taxYear,
        age: c.age,
        birthday: c.birthday || "",
        settings: c.tax,
      },
      employerPlan: pick(c, ["retirement", "hsa", "benefits", "espp"]),
      compensation: pick(c, compensationKeys),
      uploads: {
        records: c.payroll?.records || [],
        elections: c.payroll?.elections || {},
        bonusDate: c.payroll?.bonusDate || "",
        useBaseline: c.payroll?.uploadBaseline !== false,
        annualSettingKeys: c.payroll?.annualSettingKeys || [],
      },
      projection: {
        ...d.projection,
        years: v.projectionYears ?? d.projection.years,
        retirementAge: v.retirementAge ?? d.projection.retirementAge,
        inflation: v.inflation ?? d.projection.inflation,
        marketReturn: v.marketReturn ?? d.projection.marketReturn,
        socialSecurityAnnual: v.socialSecurityAnnual ?? 0,
        socialSecurityStartAge: v.socialSecurityStartAge ?? 67,
        startingBalances: {
          cash: v.cash || 0,
          brokerage: v.brokerage || 0,
          pretax401k: v.pretax401kBal || 0,
          rothAccounts: v.rothAccounts || 0,
          traditionalIRA: v.traditionalIRA || 0,
          hsa: v.hsa || 0,
        },
        monthlyExpenses: { ...d.projection.monthlyExpenses, ...v.expenses },
      },
    };
    return { scenario: normalize(s), warnings };
  }
  function engineInput(s) {
    s = normalize(s);
    return C.merge(C.defaults(), {
      ...s.compensation,
      taxYear: s.taxProfile.year,
      age: s.taxProfile.age,
      birthday: s.taxProfile.birthday,
      tax: s.taxProfile.settings,
      ...s.employerPlan,
      payroll: {
        enabled: true,
        useYtd: true,
        records: s.uploads.records,
        elections: s.uploads.elections,
        bonusDate: s.uploads.bonusDate,
        uploadBaseline: s.uploads.useBaseline,
        annualSettingKeys: s.uploads.annualSettingKeys,
        manualFields: s.uploads.manualFields || [],
      },
    });
  }
  function serialize(s) {
    return JSON.stringify(normalize(s), null, 2);
  }
  const api = { defaults, normalize, migrate, engineInput, serialize };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Scenario = api;
})(typeof window !== "undefined" ? window : globalThis);
