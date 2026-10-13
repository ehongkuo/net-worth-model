(function (root) {
  "use strict";
  const positive = (v) => Math.max(0, Number(v) || 0);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
  function merge(a, b) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b || {})) {
      if (["__proto__", "constructor", "prototype"].includes(k)) continue;
      out[k] =
        v && typeof v === "object" && !Array.isArray(v)
          ? merge(a?.[k] || {}, v)
          : v;
    }
    return out;
  }
  function defaults() {
    return {
      filing: "single",
      state: "CA",
      spouseIncome: 0,
      otherIncome: 0,
      federalDeduction: 0,
      stateDeduction: 0,
      federalCredits: 0,
      stateCredits: 0,
      federalAdjustment: 0,
      stateAdjustment: 0,
      customStateRate: 0,
      federalExtra: 0,
      stateExtra: 0,
      salaryFederalRate: null,
      salaryStateRate: null,
      bonusFederalRate: 0.22,
      bonusStateRate: 0.1023,
      rsuFederalRate: 0.22,
      rsuStateRate: 0.1023,
      caSdi: 0.013,
      caGrowth2026: 0.03,
      limitGrowth: 0.025,
      bracketGrowth: 0.025,
      wageGrowth: 0.035,
      overrides: {},
      capitalLossCarry: 0,
      estimatedPayments: 0,
      withholdingMethod: "annual-estimate",
      w4Credits: 0,
      w4OtherIncome: 0,
      w4Deductions: 0,
      w4MultipleJobs: false,
      stateTaxPaid: null,
      spouseFederalWithholding: null,
    };
  }
  // Published federal/SSA 2026 values. California income tax starts from FTB 2025.
  // Source URLs and projection conventions are documented in TAX_RULES.md.
  function limits(year, settings = {}) {
    const t = merge(defaults(), settings);
    const n = Math.max(0, year - 2026);
    const round = (v, step, rate = t.limitGrowth) =>
      Math.floor((v * (1 + rate) ** n + 1e-7) / step) * step;
    const l = {
      year,
      projected: year !== 2026,
      deferral: round(24500, 500),
      total401k: round(72000, 1000),
      compensation: round(360000, 5000),
      catchup: round(8000, 500),
      superCatchup: round(11250, 250),
      rothCatchupThreshold: round(150000, 5000, t.wageGrowth),
      ira: round(7500, 500),
      iraCatchup: round(1100, 100),
      hsaSingle: round(4400, 50),
      hsaFamily: round(8750, 50),
      hsaCatchup: 1000,
      ssBase: Math.round((184500 * (1 + t.wageGrowth) ** n) / 300) * 300,
      healthFsa: round(3400, 50),
      dependentCare: 7500,
      commuterMonthly: round(340, 5),
      espp: 25000,
      additionalMedicare: { single: 200000, married: 250000 },
      niit: { single: 200000, married: 250000 },
      federalDeduction: {
        single: 16100 * (1 + t.bracketGrowth) ** n,
        married: 32200 * (1 + t.bracketGrowth) ** n,
      },
    };
    const adjusted = merge(l, t.overrides?.[year] || {});
    for (const key of [
      "deferral",
      "total401k",
      "compensation",
      "catchup",
      "superCatchup",
      "ira",
      "iraCatchup",
      "hsaSingle",
      "hsaFamily",
      "hsaCatchup",
      "espp",
      "healthFsa",
      "dependentCare",
      "commuterMonthly",
    ])
      adjusted[key] = Math.min(l[key], positive(adjusted[key]));
    return adjusted;
  }
  function brackets(income, ends, rates, mult = 1) {
    let prev = 0,
      total = 0;
    ends.concat(Infinity).forEach((end, i) => {
      const upper = end * mult;
      total += Math.max(0, Math.min(income, upper) - prev) * rates[i];
      prev = upper;
    });
    return total;
  }
  function tax(income, year, settings = {}) {
    const t = merge(defaults(), settings),
      l = limits(year, t);
    t.caHsaConforms = false;
    const married = t.filing === "married",
      status = married ? "married" : "single";
    const f = (1 + t.bracketGrowth) ** Math.max(0, year - 2026);
    const ca =
      (1 + t.caGrowth2026) * (1 + t.bracketGrowth) ** Math.max(0, year - 2026);
    const wages = positive(income.wages),
      spouse = positive(income.spouse);
    const payrollDed = positive(income.payrollDeduction);
    const hsa = positive(income.hsa),
      employerHsa = positive(income.employerHsa);
    const pretax = positive(income.pretax);
    const ordinary = Number(income.ordinary) || 0;
    const st = Number(income.shortGain) || 0,
      lt = Number(income.longGain) || 0;
    const net = st + lt,
      loss = Math.max(-3000, Math.min(0, net));
    const longGain = Math.max(0, Math.min(lt, net));
    const shortGain = Math.max(0, net - longGain);
    const fedAgi =
      wages +
      spouse +
      ordinary +
      positive(income.federalOnly) -
      pretax -
      payrollDed -
      hsa +
      shortGain +
      loss;
    const caAgi =
      positive(income.stateBenefitAddback) +
      wages +
      spouse +
      ordinary -
      pretax -
      payrollDed +
      (t.state !== "CA" || t.caHsaConforms ? -hsa : employerHsa) +
      shortGain +
      loss;
    const caEnds = [
      11079, 26264, 41452, 57542, 72724, 371479, 445771, 742953,
    ].map((v) => (married ? v * 2 : v));
    const stateDed = Math.max(
      (married ? 11412 : 5706) * ca,
      positive(t.stateDeduction),
      positive(income.stateItemized),
    );
    const stateTaxable = Math.max(0, caAgi + longGain - stateDed);
    let state =
      t.state === "CA"
        ? brackets(
            stateTaxable,
            caEnds,
            [0.01, 0.02, 0.04, 0.06, 0.08, 0.093, 0.103, 0.113, 0.123],
            ca,
          ) +
          Math.max(0, stateTaxable - 1000000) * 0.01
        : t.state === "custom"
          ? stateTaxable * clamp(t.customStateRate, 0, 1)
          : 0;
    if (t.state === "CA") {
      const threshold = (married ? 504411 : 252203) * ca;
      const phaseout =
        Math.ceil(
          Math.max(0, caAgi + longGain - threshold) / (married ? 2500 : 1250),
        ) * 6;
      state -= Math.max(0, (married ? 306 : 153) * ca - phaseout);
    }
    state = Math.max(
      0,
      state - positive(t.stateCredits) + (Number(t.stateAdjustment) || 0),
    );
    const magi = fedAgi + longGain;
    const saltBase = year <= 2029 ? 40400 * 1.01 ** (year - 2026) : 10000;
    const saltThreshold =
      year <= 2029 ? 505000 * 1.01 ** (year - 2026) : Infinity;
    const salt = Math.max(
      10000,
      saltBase - 0.3 * Math.max(0, magi - saltThreshold),
    );
    const statePayrollTax =
      t.state === "CA"
        ? (Math.max(0, wages - payrollDed) + spouse + employerHsa) * t.caSdi
        : 0;
    const itemized =
      positive(income.mortgageInterest) +
      Math.min(
        salt,
        (t.stateTaxPaid == null
          ? state + statePayrollTax
          : positive(t.stateTaxPaid)) + positive(income.propertyTaxes),
      );
    const totalItemized = Math.max(positive(t.federalDeduction), itemized);
    const limitedItemized =
      totalItemized -
      (2 / 37) *
        Math.min(
          totalItemized,
          Math.max(0, magi - (married ? 768700 : 640600) * f),
        );
    const deduction = Math.max(l.federalDeduction[status], limitedItemized);
    const taxable = Math.max(0, fedAgi - deduction);
    const taxableLong = Math.max(0, longGain - Math.max(0, deduction - fedAgi));
    const fedEnds = married
      ? [24800, 100800, 211400, 403550, 512450, 768700]
      : [12400, 50400, 105700, 201775, 256225, 640600];
    const rates = [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];
    const cgEnds = married ? [98900, 613700] : [49450, 545500];
    const capitalTax =
      brackets(taxable + taxableLong, cgEnds, [0, 0.15, 0.2], f) -
      brackets(taxable, cgEnds, [0, 0.15, 0.2], f);
    const regular = brackets(taxable, fedEnds, rates, f) + capitalTax;
    const amtIncome = Math.max(0, magi - positive(income.mortgageInterest));
    const exemption = Math.max(
      0,
      (married ? 140200 : 90100) * f -
        0.5 * Math.max(0, amtIncome - (married ? 1000000 : 500000) * f),
    );
    const amtTaxable = Math.max(0, amtIncome - exemption);
    const amtLong = Math.min(longGain, amtTaxable);
    const amtOrdinary = amtTaxable - amtLong;
    const amtCapitalTax =
      brackets(amtOrdinary + amtLong, cgEnds, [0, 0.15, 0.2], f) -
      brackets(amtOrdinary, cgEnds, [0, 0.15, 0.2], f);
    const amt = Math.max(
      0,
      brackets(amtOrdinary, [244500], [0.26, 0.28], f) +
        amtCapitalTax -
        regular,
    );
    const niit =
      0.038 * Math.min(Math.max(0, net), Math.max(0, magi - l.niit[status]));
    const federal = Math.max(
      0,
      Math.max(0, regular + amt - positive(t.federalCredits)) +
        niit +
        (Number(t.federalAdjustment) || 0),
    );
    const w = Math.max(0, wages - payrollDed - positive(income.hsaPayroll));
    const ss = 0.062 * (Math.min(w, l.ssBase) + Math.min(spouse, l.ssBase));
    const medicare = 0.0145 * (w + spouse);
    const additionalMedicare =
      0.009 * Math.max(0, w + spouse - l.additionalMedicare[status]);
    const sdi = statePayrollTax;
    const federalBrackets = bracketRows(taxable, fedEnds, rates, f);
    const capitalBrackets = bracketRows(
      taxableLong,
      cgEnds,
      [0, 0.15, 0.2],
      f,
      taxable,
    );
    const stateBrackets =
      t.state === "CA"
        ? bracketRows(
            stateTaxable,
            caEnds,
            [0.01, 0.02, 0.04, 0.06, 0.08, 0.093, 0.103, 0.113, 0.123],
            ca,
          )
        : t.state === "custom"
          ? bracketRows(stateTaxable, [], [clamp(t.customStateRate, 0, 1)])
          : [];
    const audit = {
      year,
      settings: merge({}, t),
      income: { ...income },
      federalAgi: magi,
      stateAgi: caAgi + longGain,
      grossIncome:
        wages + spouse + ordinary + positive(income.federalOnly) + st + lt,
      pretax,
      payrollDeduction: payrollDed,
      hsa,
      capitalLossDeduction: -loss,
      standardDeduction: l.federalDeduction[status],
      itemizedDeduction: limitedItemized,
      deduction,
      deductionMethod:
        limitedItemized > l.federalDeduction[status] ? "Itemized" : "Standard",
      federalBrackets,
      capitalBrackets,
      stateBrackets,
      ordinaryTax: brackets(taxable, fedEnds, rates, f),
      capitalTax,
      regular,
      federalCreditsApplied: Math.min(
        positive(t.federalCredits),
        regular + amt,
      ),
      federalAdjustment:
        federal -
        (Math.max(0, regular + amt - positive(t.federalCredits)) + niit),
      stateBracketTax: stateBrackets.reduce((s, r) => s + r.tax, 0),
      stateNetAdjustments: state - stateBrackets.reduce((s, r) => s + r.tax, 0),
      payrollWages: w,
      spousePayrollWages: spouse,
      amtIncome,
      amtExemption: exemption,
      amtTaxable,
      projectedFederal: year !== 2026,
      projectedState: t.state === "CA",
      saltCap: salt,
    };
    return {
      audit,
      federal,
      state,
      ss,
      medicare,
      additionalMedicare,
      sdi,
      niit,
      amt,
      fica: ss + medicare + additionalMedicare,
      total: federal + state + ss + medicare + additionalMedicare + sdi,
      federalTaxable: taxable + taxableLong,
      stateTaxable,
      deduction,
      stateDeduction: stateDed,
      lossCarryforward: Math.max(0, -net - 3000),
    };
  }

  function bracketRows(amount, ends, rates, mult = 1, offset = 0) {
    let lower = 0;
    return ends.concat(Infinity).map((end, i) => {
      const upper = end * mult,
        income = Math.max(
          0,
          Math.min(offset + Math.max(0, amount), upper) -
            Math.max(lower, offset),
        );
      const row = {
        lower,
        upper,
        rate: rates[i],
        income,
        tax: income * rates[i],
      };
      lower = upper;
      return row;
    });
  }
  function federalWithholding(annualTaxable, year, settings = {}) {
    const t = merge(defaults(), settings),
      married = t.filing === "married",
      f = (1 + t.bracketGrowth) ** Math.max(0, year - 2026);
    const divisor = t.w4MultipleJobs ? 2 : 1;
    const ends = (
      married
        ? [24800, 100800, 211400, 403550, 512450, 768700]
        : [12400, 50400, 105700, 201775, 256225, 640600]
    ).map((v) => v / divisor);
    const base = Math.max(
      0,
      annualTaxable +
        positive(t.w4OtherIncome) -
        positive(t.w4Deductions) -
        limits(year, t).federalDeduction[married ? "married" : "single"] /
          divisor,
    );
    return Math.max(
      0,
      brackets(base, ends, [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37], f) -
        positive(t.w4Credits),
    );
  }
  function funding(taxes, payroll, estimatedPayments = 0) {
    const payments = positive(estimatedPayments),
      rsuWithholding = payroll.rsuSellToCover || 0;
    return {
      liability: taxes.total,
      cashWithholding: payroll.withholding - rsuWithholding,
      rsuWithholding,
      estimatedPayments: payments,
      remainingLiability: taxes.total - payroll.withholding - payments,
      additionalReserve: Math.max(
        0,
        taxes.total - payroll.withholding - payments,
      ),
      overpayment: Math.max(0, payroll.withholding + payments - taxes.total),
    };
  }
  function allocateSources(sources, rows) {
    const total = rows.reduce((s, r) => s + r.income, 0),
      gross = sources.reduce((s, r) => s + positive(r.value), 0);
    let start = 0;
    const segments = sources
      .filter((s) => s.value > 0)
      .map((s) => {
        const value = gross ? (s.value / gross) * total : 0,
          r = { ...s, start, end: start + value };
        start += value;
        return r;
      });
    let consumed = 0;
    return rows.map((row) => {
      const lower = consumed;
      consumed += row.income;
      return {
        ...row,
        sources: segments
          .map((s) => ({
            ...s,
            value: Math.max(
              0,
              Math.min(s.end, consumed) - Math.max(s.start, lower),
            ),
          }))
          .filter((s) => s.value > 1e-7),
      };
    });
  }
  // Attribution is a presentation convention, not a second tax assessment or a withholding election.
  function attribute(taxes, payroll, estimatedPayments = 0) {
    const a = taxes.audit,
      i = a.income,
      c = payroll.contributions,
      e = payroll.espp;
    const net = (i.shortGain || 0) + (i.longGain || 0),
      long = Math.max(0, Math.min(i.longGain || 0, net)),
      short = Math.max(0, net - long);
    const sources = [];
    const add = (id, label, value, color, group = "cash", wage = false) =>
      sources.push({
        id,
        label,
        gross: positive(value),
        color,
        group,
        wage,
        capitalGross: 0,
      });
    add("salary", "Base salary", payroll.salary, "#38bdf8", "cash", true);
    add("bonus", "Bonus", payroll.bonus, "#818cf8", "cash", true);
    add("spouse", "Spouse wages", i.spouse, "#2dd4bf", "cash", true);
    add(
      "imputed",
      "Noncash taxable benefits",
      payroll.imputedIncome,
      "#94a3b8",
      "cash",
      true,
    );
    add(
      "other-wages",
      "Other wages",
      (i.wages || 0) -
        payroll.salary -
        payroll.bonus -
        payroll.rsuGross -
        (payroll.imputedIncome || 0),
      "#22d3ee",
      "cash",
      true,
    );
    add("rsu", "RSU vesting", payroll.rsuGross, "#fbbf24", "rsu", true);
    add("espp", "ESPP taxable sale income", e.ordinary, "#fb923c", "espp");
    add(
      "conversion",
      "Backdoor taxable portion",
      c.iraTaxableConversion + c.conversionEarnings,
      "#c084fc",
      "other",
    );
    add(
      "other",
      "Other taxable income",
      (i.ordinary || 0) -
        e.ordinary -
        c.iraTaxableConversion -
        c.conversionEarnings +
        (i.federalOnly || 0),
      "#e879f9",
      "other",
    );
    const espp = sources.find((s) => s.id === "espp");
    const esppShort =
      short *
      Math.min(
        1,
        positive(e.shortGain) / Math.max(short, positive(e.shortGain)) || 0,
      );
    espp.gross += esppShort;
    add("gains", "Other realized gains", short - esppShort, "#f472b6", "other");
    const gains = sources.find((s) => s.id === "gains");
    espp.capitalGross =
      long *
      Math.min(
        1,
        positive(e.longGain) / Math.max(long, positive(e.longGain)) || 0,
      );
    gains.capitalGross = long - espp.capitalGross;
    const beforeOrdinary = sources.reduce((sum, s) => sum + s.gross, 0);
    const beforeRows = a.federalBrackets.map((r) => ({
      ...r,
      income: Math.max(0, Math.min(beforeOrdinary, r.upper) - r.lower),
      tax: Math.max(0, Math.min(beforeOrdinary, r.upper) - r.lower) * r.rate,
    }));
    const deductions = payroll.deductionSources || {
      salary: a.pretax + a.payrollDeduction + a.hsa,
    };
    sources.forEach((s) => {
      s.payrollDeduction = Math.min(s.gross, positive(deductions[s.id]));
      s.afterPretax = s.gross - s.payrollDeduction;
    });
    const afterPretax = sources.reduce((sum, s) => sum + s.afterPretax, 0);
    const afterPretaxRows = beforeRows.map((r) => ({
      ...r,
      income: Math.max(0, Math.min(afterPretax, r.upper) - r.lower),
      tax: Math.max(0, Math.min(afterPretax, r.upper) - r.lower) * r.rate,
    }));
    const afterRows = allocateSources(
      sources.map((s) => ({ ...s, value: s.afterPretax })),
      a.federalBrackets,
    );
    const afterOrdinary = a.federalBrackets.reduce(
      (sum, r) => sum + r.income,
      0,
    );
    const capitalTaxable = a.capitalBrackets.reduce(
      (sum, r) => sum + r.income,
      0,
    );
    sources.forEach((s) => {
      s.slices = afterRows.flatMap((r) =>
        r.sources
          .filter((part) => part.id === s.id)
          .map((part) => ({
            lower: r.lower,
            upper: r.upper,
            rate: r.rate,
            income: part.value,
            tax: part.value * r.rate,
          })),
      );
      s.taxable = s.slices.reduce((sum, r) => sum + r.income, 0);
      s.deduction = s.gross - s.taxable;
      s.federalOrdinary = s.slices.reduce((sum, r) => sum + r.tax, 0);
      s.capitalTaxable = long ? (s.capitalGross / long) * capitalTaxable : 0;
      s.capitalTax = long ? (s.capitalGross / long) * a.capitalTax : 0;
      s.federal = s.federalOrdinary + s.capitalTax;
      s.state = 0;
      s.payroll = 0;
    });
    const distribute = (amount, key, weight) => {
      let weights = sources.map(weight),
        total = weights.reduce((sum, v) => sum + v, 0);
      if (!total) {
        weights = sources.map((s) => (s.id === "other" ? 1 : 0));
        total = 1;
      }
      sources.forEach(
        (s, index) => (s[key] += (amount * weights[index]) / total),
      );
    };
    distribute(
      taxes.federal - a.regular,
      "federal",
      (s) => s.federalOrdinary + s.capitalTax,
    );
    distribute(taxes.state, "state", (s) => s.gross + s.capitalGross);
    // Preserve the payroll engine's RSU wage-cap timing; allocate remaining payroll tax among cash wages.
    const rsu = sources.find((s) => s.id === "rsu");
    rsu.payroll = Math.min(
      taxes.fica + taxes.sdi,
      (payroll.months || []).reduce(
        (sum, m) => sum + (m.rsuPayrollTax || 0),
        0,
      ),
    );
    distribute(taxes.fica + taxes.sdi - rsu.payroll, "payroll", (s) =>
      s.wage && s.id !== "rsu" ? s.gross : 0,
    );
    sources.forEach((s) => {
      s.total = s.federal + s.state + s.payroll;
    });
    const groups = [
      ["cash", "Cash compensation"],
      ["rsu", "RSU vesting"],
      ["espp", "ESPP sale income"],
      ["other", "Other income / adjustments"],
    ].map(([id, label]) => {
      const members = sources.filter((s) => s.group === id);
      const row = { id, label };
      for (const key of [
        "gross",
        "capitalGross",
        "taxable",
        "deduction",
        "federalOrdinary",
        "capitalTax",
        "federal",
        "state",
        "payroll",
        "total",
      ])
        row[key] = members.reduce((sum, s) => sum + s[key], 0);
      return row;
    });
    const rsuGroup = groups.find((g) => g.id === "rsu");
    const cashWithholding =
      payroll.cashWithholding ??
      payroll.withholding - (payroll.rsuSellToCover || 0);
    const rsuCash = Math.min(
      positive(cashWithholding),
      positive(
        (payroll.months || []).reduce(
          (sum, m) => sum + (m.rsuWithholding || 0),
          0,
        ) - (payroll.rsuSellToCover || 0),
      ),
    );
    const liability = taxes.total;
    groups.forEach((g) => {
      g.cover = g.id === "rsu" ? payroll.rsuSellToCover || 0 : 0;
      g.cashWithholding =
        g.id === "rsu"
          ? rsuCash
          : g.id === "cash"
            ? cashWithholding - rsuCash
            : 0;
      g.estimatedPayments = liability
        ? (positive(estimatedPayments) * Math.max(0, g.total)) / liability
        : g.id === "other"
          ? positive(estimatedPayments)
          : 0;
      g.balance = g.total - g.cashWithholding - g.cover - g.estimatedPayments;
    });
    const balance = groups.reduce((sum, g) => sum + g.balance, 0),
      positiveBalance = groups.reduce((sum, g) => sum + positive(g.balance), 0);
    groups.forEach((g) => {
      g.reserve = positiveBalance
        ? (positive(balance) * positive(g.balance)) / positiveBalance
        : 0;
    });
    return {
      sources: sources.filter(
        (s) => s.gross + s.capitalGross + Math.abs(s.total) > 1e-8,
      ),
      groups,
      beforeOrdinary,
      afterOrdinary,
      afterPretax,
      afterPretaxRows,
      householdDeductions: Math.max(0, afterPretax - afterOrdinary),
      beforeRows,
      afterRows,
      beforeBracketTax: beforeRows.reduce((sum, r) => sum + r.tax, 0),
      afterBracketTax: a.ordinaryTax,
      capitalGross: long,
      capitalTaxable,
      total: taxes.total,
      rsuBalance: rsuGroup.balance,
    };
  }

  const api = {
    attribute,
    defaults,
    limits,
    calculate: tax,
    bracketRows,
    federalWithholding,
    funding,
    allocateSources,
  };
  if (typeof module !== "undefined") module.exports = api;
  root.TaxEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
