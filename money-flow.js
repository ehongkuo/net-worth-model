(function (root) {
  "use strict";
  const colors = {
    cash: "var(--cash)",
    loss: "var(--tax)",
    asset: "var(--retire)",
    equity: "var(--equity)",
    funding: "var(--equity-2)",
  };
  function buildFlow(p, f) {
    const nodes = [],
      links = [];
    const node = (id, label, column, type = "cash", kind = "sink") => {
      nodes.push({ id, label, column, color: colors[type], kind });
      return id;
    };
    const link = (source, target, value) => {
      if (value > 1e-7) links.push({ source, target, value });
    };
    node("gross", "Gross cash pay", 1, "cash", "hub");
    node("takehome", "Take-home cash", 2, "cash", "hub");
    node("available", "Cash to allocate", 3, "cash", "hub");
    let gross = 0;
    for (const [id, label, value] of [
      ["salary", "Base salary", p.salary],
      ["allowance", "Cash allowances", p.cashAllowance || 0],
      ["bonus", "Bonus", p.bonus],
      ["spouse", "Spouse pay", p.income.spouse],
    ]) {
      if (value > 0) {
        node(id, label, 0, "cash", "source");
        link(id, "gross", value);
        gross += value;
      }
    }
    if (p.rsuCash > 0) {
      node("rsu-vesting", "RSUs vested (amortized)", 0, "equity", "source");
      link("rsu-vesting", "gross", p.rsuCash);
      gross += p.rsuCash;
    }
    const payrollHsa = p.income.hsaPayroll || 0;
    const deductions = [
      [
        "withholding",
        "Cash tax withholding",
        p.cashWithholding ?? p.withholding,
        "loss",
      ],
      [
        "traditional",
        "Traditional 401(k), pre-tax",
        p.contributions.traditional,
        "asset",
      ],
      ["roth", "Roth 401(k), after-tax", p.contributions.roth, "asset"],
      ["mega", "Mega backdoor, after-tax", p.contributions.mega, "asset"],
      ["hsa", "Payroll HSA", payrollHsa, "asset"],
      ["espp", "ESPP purchases / funding", p.espp.contributions, "equity"],
      ["benefits", "Benefits", p.benefits, "loss"],
    ];
    let payrollDeductions = 0;
    deductions.forEach(([id, label, value, type]) => {
      if (value > 0) {
        node(id, label, 2, type);
        link("gross", id, value);
        payrollDeductions += value;
      }
    });
    const takeHome = gross - payrollDeductions;
    const payrollFunding = Math.max(0, -takeHome);
    if (payrollFunding) {
      node("payroll-funding", "Payroll funding needed", 0, "funding", "source");
      link("payroll-funding", "gross", payrollFunding);
    }
    link("gross", "takehome", Math.max(0, takeHome));
    link("takehome", "available", Math.max(0, takeHome));
    let otherCash = 0,
      otherCosts = 0;
    for (const [id, label, value] of [
      ["other", "Other / rental cash", f.otherIncome],
      ["ss", "Social Security", f.socialSecurity],
      ["espp-return", "ESPP sales + refunds", p.espp.proceeds + p.espp.refunds],
      ["tax-refund", "Estimated tax overpayment", Math.max(0, -f.taxBalance)],
    ]) {
      if (value > 0) {
        node(id, label, 2, "cash", "source");
        link(id, "available", value);
        otherCash += value;
      } else if (value < 0) {
        node(id, label + " outflow", 4, "loss");
        link("available", id, -value);
        otherCosts -= value;
      }
    }
    const uses = [
      ["living", "Living expenses", f.expenses, "loss"],
      ["ira", "IRA / backdoor Roth", p.contributions.ira, "asset"],
      [
        "direct-hsa",
        "Direct HSA transfer",
        p.contributions.hsa - payrollHsa,
        "asset",
      ],
      [
        "tax-payments",
        "Estimated taxes paid",
        f.taxFunding?.estimatedPayments || 0,
        "loss",
      ],
      [
        "tax-reserve",
        "Expected additional taxes",
        Math.max(0, f.taxBalance),
        "loss",
      ],
      [
        "future-tax-reserve",
        "Cash reserved for future ESPP tax",
        f.futureTaxReserve || 0,
        "asset",
      ],
    ];
    uses.forEach(([id, label, value, type]) => {
      if (value > 0) {
        node(id, label, 4, type);
        link("available", id, value);
        otherCosts += value;
      }
    });
    const budget = Math.max(0, takeHome) + otherCash - otherCosts;
    const budgetFunding = Math.max(0, -budget);
    if (budgetFunding) {
      node(
        "budget-funding",
        "Savings needed for budget",
        2,
        "funding",
        "source",
      );
      link("budget-funding", "available", budgetFunding);
    }
    if (budget > 0) {
      node("remaining", "Remaining cash", 4);
      link("available", "remaining", budget);
    }
    const inPeriod = (date) =>
      Number(date.slice(0, 4)) === p.year &&
      (!p.periodMonth || Number(date.slice(5, 7)) === p.periodMonth);
    const periodStart = `${p.year}-${String(p.periodMonth || 1).padStart(2, "0")}-01`;
    const periodEnd = p.periodMonth
      ? `${p.year}-${String(p.periodMonth).padStart(2, "0")}-31`
      : `${p.year}-12-31`;
    const purchased = p.espp.lots.filter((l) => inPeriod(l.purchaseDate));
    const sold = p.espp.lots.filter((l) => !l.held && inPeriod(l.saleDate));
    const purchaseCost = purchased.reduce((s, l) => s + l.cost, 0);
    const esppDiscount = purchased.reduce(
      (s, l) => s + Math.max(0, l.shares * l.purchasePrice - l.cost),
      0,
    );
    const priorSold = sold.filter((l) => l.purchaseDate < periodStart);
    const priorValue = (l) =>
      Number(l.purchaseDate.slice(0, 4)) < p.year
        ? (l.openingValue ?? l.shares * l.purchasePrice)
        : l.shares * l.purchasePrice;
    const priorCost = priorSold.reduce((s, l) => s + priorValue(l), 0);
    const movement = sold.map(
      (l) =>
        l.proceeds -
        (inPeriod(l.purchaseDate)
          ? l.cost + Math.max(0, l.shares * l.purchasePrice - l.cost)
          : priorValue(l)),
    );
    const saleGrowth = movement.reduce((s, v) => s + Math.max(0, v), 0),
      saleLoss = movement.reduce((s, v) => s + Math.max(0, -v), 0);
    const pending = p.espp.contributions - p.espp.refunds - purchaseCost;
    const retained = purchased
      .filter((l) => l.held || l.saleDate > periodEnd)
      .reduce(
        (s, l) => s + l.cost + Math.max(0, l.shares * l.purchasePrice - l.cost),
        0,
      );
    // ESPP proceeds recycle principal. Only the purchase benefit and later gains are new value.
    const oldReturn = links.findIndex((l) => l.source === "espp-return");
    if (oldReturn >= 0) links.splice(oldReturn, 1);
    const oldNode = nodes.findIndex((n) => n.id === "espp-return");
    if (oldNode >= 0) nodes.splice(oldNode, 1);
    if (!nodes.some((n) => n.id === "espp"))
      node("espp", "ESPP purchases / funding", 2, "equity", "hub");
    nodes.find((n) => n.id === "espp").kind = "hub";
    const source = (id, label, value, target, type = "equity") => {
      if (value > 1e-7) {
        node(id, label, 0, type, "source");
        link(id, target, value);
      }
    };
    source("espp-discount", "ESPP purchase benefit", esppDiscount, "espp");
    source("espp-growth", "ESPP sale gains", saleGrowth, "espp");
    source("espp-released", "Existing ESPP shares sold", priorCost, "espp");
    source(
      "espp-cash-released",
      "Previously accumulated ESPP cash",
      Math.max(0, -pending),
      "espp",
      "cash",
    );
    link("espp", "available", p.espp.proceeds + p.espp.refunds);
    node("equity-account", "Equity retained", 4, "equity", "asset");
    link("espp", "equity-account", retained);
    if (pending > 0) {
      node(
        "espp-pending-account",
        "ESPP cash awaiting purchase",
        4,
        "cash",
        "asset",
      );
      link("espp", "espp-pending-account", pending);
    }
    if (saleLoss) {
      node("espp-loss", "ESPP value lost / fees", 4, "loss");
      link("espp", "espp-loss", saleLoss);
    }
    node("retirement-account", "Retirement accounts", 4, "asset", "asset");
    node("hsa-account", "HSA account", 4, "asset", "asset");
    for (const [id, target] of [
      ["traditional", "retirement-account"],
      ["roth", "retirement-account"],
      ["mega", "retirement-account"],
      ["hsa", "hsa-account"],
    ]) {
      const n = nodes.find((n) => n.id === id);
      if (n) {
        n.kind = "hub";
        const amount = links
          .filter((l) => l.target === id)
          .reduce((s, l) => s + l.value, 0);
        link(id, target, amount);
      }
    }
    // Post-payroll contributions feed the same account destinations without creating income.
    for (const [id, target] of [
      ["ira", "retirement-account"],
      ["direct-hsa", "hsa-account"],
    ]) {
      const l = links.find((l) => l.target === id);
      if (l) l.target = target;
      const i = nodes.findIndex((n) => n.id === id);
      if (i >= 0) nodes.splice(i, 1);
    }
    const heldRsu = Math.max(
      0,
      p.rsuGross - p.rsuCash - (p.rsuSellToCover || 0),
    );
    if (heldRsu > 0) {
      if (!nodes.some((n) => n.id === "rsu-vesting"))
        node("rsu-vesting", "RSUs vested (amortized)", 0, "equity", "source");
      link("rsu-vesting", "equity-account", heldRsu);
    }
    if (p.rsuSellToCover > 0) {
      if (!nodes.some((n) => n.id === "rsu-vesting"))
        node("rsu-vesting", "RSUs vested (amortized)", 0, "equity", "source");
      node("rsu-cover", "RSU sell-to-cover taxes", 2, "loss");
      link("rsu-vesting", "rsu-cover", p.rsuSellToCover);
    }
    source(
      "employer-retirement",
      "Employer retirement",
      p.contributions.employer,
      "retirement-account",
      "asset",
    );
    source(
      "employer-hsa",
      "Employer HSA",
      p.contributions.hsaEmployer,
      "hsa-account",
      "asset",
    );
    const reserveNode = nodes.find((n) => n.id === "future-tax-reserve");
    if (reserveNode) reserveNode.kind = "asset";
    const remaining = nodes.find((n) => n.id === "remaining");
    if (remaining) {
      remaining.kind = "asset";
      remaining.label = "Unallocated cash";
    }
    if (f.taxAttribution) {
      const groups = f.taxAttribution.groups;
      const replacePayment = (id, field, prefix) => {
        const original = links.find((l) => l.target === id);
        if (!original) return;
        links.splice(links.indexOf(original), 1);
        const old = nodes.findIndex((n) => n.id === id);
        if (old >= 0) nodes.splice(old, 1);
        groups
          .filter((g) => g[field] > 1e-7)
          .forEach((g) => {
            const target = `${id}-${g.id}`;
            node(
              target,
              `${g.label}: ${prefix}`,
              id === "withholding" ? 2 : 4,
              "loss",
            );
            link(original.source, target, g[field]);
          });
      };
      replacePayment("withholding", "cashWithholding", "cash withheld");
      replacePayment("tax-reserve", "reserve", "additional tax");
      replacePayment("tax-payments", "estimatedPayments", "estimated payment");
      const rsu = groups.find((g) => g.id === "rsu");
      links
        .filter((l) => l.source === "rsu-vesting" || l.target.includes("rsu"))
        .forEach((l) => {
          l.taxDetail = {
            label: p.periodMonth
              ? "RSU tax funding (with planning settlement)"
              : "RSU attributed tax",
            liability: rsu.total,
            cover: rsu.cover,
            cash: rsu.cashWithholding,
            balance: rsu.balance,
          };
        });
    }
    const active = new Set(links.flatMap((l) => [l.source, l.target]));
    // Allocate the upper payroll ribbon to take-home before allocating deductions.
    links.sort(
      (a, b) =>
        (a.source === "gross" && a.target === "takehome" ? -1 : 0) -
        (b.source === "gross" && b.target === "takehome" ? -1 : 0),
    );
    const nonCash = [
      { label: "RSUs kept invested", value: heldRsu, color: colors.equity },
      {
        label: "Employer retirement funding",
        value: p.contributions.employer,
        color: colors.asset,
      },
      {
        label: "Employer HSA funding",
        value: p.contributions.hsaEmployer,
        color: colors.asset,
      },
    ].filter((r) => r.value > 0);
    return {
      nodes: nodes.filter((n) => active.has(n.id)),
      links,
      nonCash,
      summary: {
        retirementBreakdown: {
          mega: p.contributions.mega,
          ira: p.contributions.ira,
        },
        pretaxBenefits: p.income.payrollDeduction || 0,
        grossCashPay: gross,
        payrollDeductions,
        takeHome,
        rsuIncome: p.rsuGross,
        esppDiscount,
        assetAdditions:
          p.contributions.totalEmployee +
          p.contributions.employer +
          p.contributions.hsaEmployer +
          heldRsu +
          retained +
          Math.max(0, pending),
        totalIncome:
          gross +
          heldRsu +
          (p.rsuSellToCover || 0) +
          esppDiscount +
          saleGrowth +
          p.contributions.employer +
          p.contributions.hsaEmployer +
          Math.max(0, f.otherIncome) +
          Math.max(0, f.socialSecurity),
        assetTransfers: p.contributions.totalEmployee + p.espp.contributions,
        taxes: f.taxes.total,
        spending: f.expenses + p.benefits,
        remainingCash: Math.max(0, budget),
        fundingNeeded: payrollFunding + budgetFunding,
        netCashFlow: f.netCashFlow,
        spendableCashFlow: f.spendableCashFlow,
      },
    };
  }

  function forMonth(payroll, flow, month) {
    const m = flow.months.find((m) => m.month === month);
    if (!m) throw new RangeError("Month must be within the modeled year");
    const contributions = {
      ...payroll.contributions,
      ...m.accountContributions,
    };
    const p = {
      ...payroll,
      periodMonth: month,
      salary: m.salary,
      cashAllowance: m.allowance || 0,
      imputedIncome: m.imputed || 0,
      bonus: m.bonus,
      rsuGross: m.rsu,
      rsuCash: m.rsuCash,
      esppSpread: m.esppSpread || 0,
      rsuSellToCover: m.rsuSellToCover,
      withholding: m.withholding,
      cashWithholding: m.cashWithholding,
      benefits: m.benefits,
      contributions,
      income: {
        ...payroll.income,
        spouse: m.spouseIncome,
        hsaPayroll: m.payrollHsa,
        payrollDeduction:
          m.pretaxBenefits ??
          (payroll.benefits
            ? (m.benefits * (payroll.income.payrollDeduction || 0)) /
              payroll.benefits
            : 0),
      },
      espp: {
        ...payroll.espp,
        contributions: m.esppContributions,
        proceeds: m.esppSaleProceeds,
        refunds: m.esppRefund,
      },
    };
    const groups = flow.taxAttribution?.groups.map((g) => {
      const cover = g.id === "rsu" ? m.rsuSellToCover : 0;
      const rsuCash = Math.min(
        Math.max(0, m.cashWithholding),
        Math.max(0, m.rsuWithholding - m.rsuSellToCover),
      );
      const cashWithholding =
        g.id === "rsu"
          ? rsuCash
          : g.id === "cash"
            ? m.cashWithholding - rsuCash
            : 0;
      const estimatedPayments = g.estimatedPayments / 12,
        balance = g.balance / 12;
      return {
        ...g,
        annualLiability: g.total,
        total: cashWithholding + cover + estimatedPayments + balance,
        cashWithholding,
        cover,
        estimatedPayments,
        balance,
        reserve: g.reserve / 12,
      };
    });
    const taxes =
      m.cashWithholding +
      m.rsuSellToCover +
      m.estimatedTaxPayments +
      m.taxAdjustment;
    const f = {
      ...flow,
      periodMonth: month,
      expenses: m.livingExpenses,
      otherIncome: m.otherIncome,
      socialSecurity: m.socialSecurity,
      taxBalance: m.taxAdjustment,
      futureTaxReserve: m.futureTaxReserve,
      netCashFlow: m.netCashFlow,
      spendableCashFlow: m.spendableCashFlow,
      afterTaxCash: m.netCashFlow + m.livingExpenses,
      taxes: { ...flow.taxes, total: taxes },
      taxFunding: {
        ...flow.taxFunding,
        liability: taxes,
        cashWithholding: m.cashWithholding,
        rsuWithholding: m.rsuSellToCover,
        estimatedPayments: m.estimatedTaxPayments,
        remainingLiability: m.taxAdjustment,
      },
      taxAttribution: groups ? { ...flow.taxAttribution, groups } : null,
    };
    f.cashIn =
      m.salary +
      (m.allowance || 0) +
      m.bonus +
      m.rsuCash +
      m.spouseIncome +
      m.otherIncome +
      m.esppProceeds +
      m.socialSecurity;
    f.cashOut = f.cashIn - f.netCashFlow;
    return { payroll: p, flow: f };
  }
  // Default order for trimming unfunded transfers.
  const FUNDING_ORDER = ["cash", "espp", "rsu", "retirement"];
  // Spending follows the chart top to bottom: cash (spendable, then the
  // future-tax reserve), then equity (ESPP shares, RSUs, and last the ESPP cash
  // awaiting purchase, since using it means withdrawing from the offering and
  // losing that purchase's discount), then retirement. HSA money is left for
  // medical costs. projection.js draw() follows the same order.
  const SPENDING_ORDER = [
    "cash",
    "reserve",
    "espp",
    "rsu",
    "pending",
    "retirement",
  ];
  function allocateCosts(accounts, costs, order = FUNDING_ORDER) {
    const remaining = Object.fromEntries(
      Object.entries(accounts).map(([key, value]) => [key, Math.max(0, value)]),
    );
    const used = Object.fromEntries(order.map((key) => [key, 0]));
    let shortfall = Math.max(0, costs);
    for (const key of order) {
      used[key] = Math.min(remaining[key] || 0, shortfall);
      remaining[key] = (remaining[key] || 0) - used[key];
      shortfall -= used[key];
    }
    return { used, remaining, shortfall };
  }

  function orderFlow(graph) {
    const allowance = graph.nodes.find((n) => n.id === "allowance");
    if (allowance) {
      const salaryValue = graph.links
          .filter((l) => l.source === "salary")
          .reduce((s, l) => s + l.value, 0),
        allowanceValue = graph.links
          .filter((l) => l.source === "allowance")
          .reduce((s, l) => s + l.value, 0);
      const salary = graph.nodes.find((n) => n.id === "salary") || {
        ...allowance,
        id: "salary",
      };
      graph = {
        ...graph,
        nodes: [
          ...graph.nodes.filter((n) => !["salary", "allowance"].includes(n.id)),
          {
            ...salary,
            label: "Salary + cash allowances",
            components: [
              { label: "Base salary", value: salaryValue },
              { label: "Cash allowances", value: allowanceValue },
            ],
          },
        ],
        links: graph.links.map((l) => ({
          ...l,
          source: l.source === "allowance" ? "salary" : l.source,
        })),
      };
    }
    const incoming = (id) =>
      graph.links
        .filter((l) => l.target === id)
        .reduce((sum, l) => sum + l.value, 0);
    const outgoing = (id) =>
      graph.links
        .filter((l) => l.source === id)
        .reduce((sum, l) => sum + l.value, 0);
    const nodes = graph.nodes
      .filter(
        (n) =>
          n.kind === "source" &&
          !["payroll-funding", "budget-funding"].includes(n.id),
      )
      .map((n) => ({
        ...n,
        column: 0,
        label: n.label.replace(" (amortized)", ""),
      }));
    const links = [],
      add = (source, target, value, extra = {}) => {
        if (value > 1e-7) links.push({ source, target, value, ...extra });
      };
    const node = (id, label, column, color = colors.cash, kind = "hub") =>
      nodes.push({ id, label, column, color, kind });
    node("combined", "Total incoming value", 1);
    nodes
      .filter((n) => n.kind === "source")
      .forEach((n) => add(n.id, "combined", outgoing(n.id)));
    let available = links.reduce((sum, l) => sum + l.value, 0),
      unfunded = 0;
    const take = (value) => {
      const amount = Math.min(available, Math.max(0, value));
      unfunded += Math.max(0, value - amount);
      available -= amount;
      return amount;
    };
    const pretax = { retirement: 0, hsa: 0 };
    for (const [id, key] of [
      ["traditional", "retirement"],
      ["hsa", "hsa"],
    ]) {
      const original = graph.nodes.find((n) => n.id === id);
      if (!original) continue;
      const amount = take(incoming(id));
      pretax[key] += amount;
      node(id, original.label, 2, colors.asset);
      add("combined", id, amount);
      add(id, `account-${key}`, amount);
    }
    const pretaxBenefits = Math.min(
      incoming("benefits"),
      graph.summary.pretaxBenefits || 0,
    );
    if (pretaxBenefits) {
      node(
        "benefits-pretax",
        "Pre-tax insurance / benefits",
        2,
        colors.loss,
        "sink",
      );
      add("combined", "benefits-pretax", take(pretaxBenefits));
    }
    node("after-deductions", "After pre-tax deductions", 2);
    add("combined", "after-deductions", available);
    const endpoints = graph.nodes.filter(
      (n) => n.kind !== "source" && n.kind !== "hub",
    );
    const taxNodes = endpoints.filter((n) =>
      /^(withholding|tax-payments|tax-reserve|rsu-cover)/.test(n.id),
    );
    for (const n of taxNodes) {
      nodes.push({ ...n, column: 3 });
      const old = graph.links.find((l) => l.target === n.id);
      add(
        "after-deductions",
        n.id,
        take(incoming(n.id)),
        old?.taxDetail ? { taxDetail: old.taxDetail } : {},
      );
    }
    node("after-tax", "After tax payments", 3);
    add("after-deductions", "after-tax", available);
    const postBenefits = Math.max(0, incoming("benefits") - pretaxBenefits);
    if (postBenefits) {
      node(
        "benefits-posttax",
        "Post-tax benefits spending",
        4,
        colors.loss,
        "sink",
      );
      add("after-tax", "benefits-posttax", take(postBenefits));
    }
    const rsu = graph.links
      .filter(
        (l) => l.target === "equity-account" && l.source === "rsu-vesting",
      )
      .reduce((sum, l) => sum + l.value, 0);
    const earmark = incoming("future-tax-reserve");
    const intended = {
      cash: 0,
      espp: Math.max(0, incoming("equity-account") - rsu),
      rsu,
      retirement: Math.max(
        0,
        incoming("retirement-account") - pretax.retirement,
      ),
      hsa: Math.max(0, incoming("hsa-account") - pretax.hsa),
      reserve: earmark,
      pending: incoming("espp-pending-account"),
    };
    const assetTotal = Object.values(intended).reduce((a, b) => a + b, 0);
    intended.cash = Math.max(0, available - assetTotal);
    // Remove unfunded transfers from the illustration instead of inventing income.
    const constrained = allocateCosts(
      intended,
      Math.max(0, assetTotal - available),
    );
    let constrainedGap = constrained.shortfall;
    for (const key of ["reserve", "hsa", "pending"]) {
      const cut = Math.min(constrained.remaining[key], constrainedGap);
      constrained.remaining[key] -= cut;
      constrainedGap -= cut;
    }
    const accounts = {
      ...constrained.remaining,
      retirement: constrained.remaining.retirement + pretax.retirement,
      hsa: constrained.remaining.hsa + pretax.hsa,
    };
    const costs = endpoints.filter(
      (n) => n.kind !== "asset" && !taxNodes.includes(n),
    );
    const costBreakdown = costs
      .filter((n) => n.id !== "benefits")
      .map((n) => ({
        label: n.id === "benefits" ? "Post-tax benefits" : n.label,
        value: incoming(n.id) - (n.id === "benefits" ? pretaxBenefits : 0),
      }))
      .filter((n) => n.value > 1e-7);
    const costTotal = costBreakdown.reduce((sum, n) => sum + n.value, 0);
    const allocation = allocateCosts(accounts, costTotal, SPENDING_ORDER);
    const labels = {
      cash: "Cash before expenses",
      espp: "ESPP assets",
      rsu: "RSU equity",
      retirement: "Retirement accounts",
      hsa: "HSA account",
      reserve: "Future-tax cash reserve",
      pending: "ESPP cash awaiting purchase",
    };
    node("costs", "Expenses (illustrative funding)", 5, colors.loss, "sink");
    for (const [key, label] of Object.entries(labels)) {
      const id = `account-${key}`,
        color = ["espp", "rsu"].includes(key)
          ? colors.equity
          : ["retirement", "hsa"].includes(key)
            ? colors.asset
            : colors.cash;
      node(id, label, 4, color);
      add("after-tax", id, constrained.remaining[key] || 0);
      add(id, "costs", allocation.used[key] || 0, {
        visualOnly: true,
        costBreakdown,
      });
      if (allocation.remaining[key] > 1e-7) {
        node(
          `remaining-${key}`,
          `${key === "reserve" ? "Reserved cash" : label.replace(" before expenses", "")} remaining`,
          5,
          color,
          "asset",
        );
        add(id, `remaining-${key}`, allocation.remaining[key], {
          visualOnly: true,
        });
      }
    }
    // Split the retirement presentation without changing the aggregate cost-allocation policy.
    let splitRoom = constrained.remaining.retirement || 0;
    for (const [key, label] of [
      ["mega", "Mega backdoor Roth"],
      ["ira", "Regular IRA / backdoor Roth"],
    ]) {
      const amount = Math.min(
        splitRoom,
        graph.summary.retirementBreakdown?.[key] || 0,
      );
      if (!amount) continue;
      splitRoom -= amount;
      const total = accounts.retirement,
        spent = total
          ? (amount * (allocation.used.retirement || 0)) / total
          : 0;
      node(`account-${key}`, label, 4, colors.asset);
      const feed = links.find(
        (l) => l.source === "after-tax" && l.target === "account-retirement",
      );
      if (feed) feed.value -= amount;
      add("after-tax", `account-${key}`, amount);
      const cost = links.find(
        (l) => l.source === "account-retirement" && l.target === "costs",
      );
      if (cost) cost.value -= spent;
      add(`account-${key}`, "costs", spent, {
        visualOnly: true,
        costBreakdown,
      });
      const keep = amount - spent,
        old = links.find(
          (l) =>
            l.source === "account-retirement" &&
            l.target === "remaining-retirement",
        );
      if (old) old.value -= keep;
      if (keep > 1e-7) {
        node(
          `remaining-${key}`,
          `${label} remaining`,
          5,
          colors.asset,
          "asset",
        );
        add(`account-${key}`, `remaining-${key}`, keep, { visualOnly: true });
      }
    }
    for (let i = links.length - 1; i >= 0; i--)
      if (links[i].value < 1e-7) links.splice(i, 1);
    const active = new Set(links.flatMap((l) => [l.source, l.target]));
    return {
      ...graph,
      nodes: nodes.filter((n) => active.has(n.id)),
      links,
      columnCount: 6,
      visualAllocation: {
        ...allocation,
        costs: costTotal,
        costBreakdown,
        unfundedBeforeExpenses: unfunded,
        constrainedTransfers: Math.max(0, assetTotal - available),
        cashShortfall: Math.max(0, -graph.summary.spendableCashFlow),
      },
    };
  }

  const roundMoney = (value) =>
    (Math.sign(value) * Math.round((Math.abs(value) + 1e-9) * 100)) / 100;
  const api = {
    buildFlow,
    forMonth,
    orderFlow,
    allocateCosts,
    SPENDING_ORDER,
    roundMoney,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MoneyFlow = api;
})(typeof window !== "undefined" ? window : globalThis);
