(function (root) {
  "use strict";
  const F =
    typeof module !== "undefined" && module.exports
      ? require("./money-flow")
      : root.MoneyFlow;
  const palette = {
    cash: "var(--cash)",
    equity: "var(--equity)",
    retirement: "var(--retire)",
    tax: "var(--tax)",
  };
  const Util =
    typeof module !== "undefined" && module.exports
      ? require("./util")
      : root.Util;
  const { positive, escape } = Util;
  const sum = (rows) => rows.reduce((s, r) => s + r.value, 0);
  function build(p, f, c) {
    const original = F.orderFlow(F.buildFlow(p, f));
    const incoming = (id) => sum(original.links.filter((l) => l.target === id));
    const account = (key) => incoming("account-" + key);
    const labels = {
      cash: "Spendable cash",
      pending: "Pending ESPP contributions",
      reserve: "Future-tax cash reserve",
      espp: "ESPP shares",
      rsu: "Retained RSUs",
      retirement: "Traditional / Roth 401(k) and employer funding",
      mega: "Mega backdoor Roth",
      ira: "Regular IRA / backdoor Roth",
      hsa: "HSA",
    };
    const groups = [
      ["cash", ["cash", "pending", "reserve"]],
      ["equity", ["espp", "rsu"]],
      ["retirement", ["retirement", "mega", "ira", "hsa"]],
    ];
    const buckets = groups.map(([id, keys]) => {
      const parts = keys
        .map((k) => ({ label: labels[k], value: account(k) }))
        .filter((p) => p.value > 0);
      const used = sum(
        original.links.filter(
          (l) =>
            keys.some((k) => l.source === "account-" + k) &&
            l.target === "costs",
        ),
      );
      return {
        id,
        label: id[0].toUpperCase() + id.slice(1),
        value: sum(parts),
        used,
        remaining: sum(parts) - used,
        parts,
      };
    });
    const inPeriod = (d) =>
      Number(d.slice(0, 4)) === p.year &&
      (!p.periodMonth || Number(d.slice(5, 7)) === p.periodMonth);
    const rsuBaseline = (p.rsuVests || [])
      .filter((v) => inPeriod(v.date))
      .reduce(
        (s, v) => s + v.shares * (c.grants[v.grantIndex]?.grantPrice || 100),
        0,
      );
    const lots = p.espp.lots.filter(
      (l) =>
        inPeriod(l.purchaseDate) &&
        (l.held ||
          l.saleDate >
            (p.periodMonth
              ? `${p.year}-${String(p.periodMonth).padStart(2, "0")}-31`
              : `${p.year}-12-31`)),
    );
    const esppMarket = lots.reduce((s, l) => s + l.shares * l.purchasePrice, 0),
      esppValueActual = account("espp");
    let esppValue = esppValueActual;
    let esppCost = esppMarket
      ? (lots.reduce((s, l) => s + l.cost, 0) * esppValue) / esppMarket
      : 0;
    const projectedEspp = { cost: 0, value: 0, shares: 0, valuations: [] };
    if (p.periodMonth && account("pending") > 0) {
      const monthEnd = `${p.year}-${String(p.periodMonth).padStart(2, "0")}-31`;
      const pendingOffers = (p.espp.offerings || []).filter(
        (o) =>
          o.enrolled && o.grantDate <= monthEnd && o.purchaseDate > monthEnd,
      );
      const weighted = pendingOffers.map((o) => ({
        o,
        weight: (p.paychecks || [])
          .filter(
            (r) =>
              inPeriod(r.date) && r.date >= o.grantDate && r.date <= o.endDate,
          )
          .reduce((n, r) => n + positive(r.espp), 0),
      }));
      const weight = weighted.reduce((n, r) => n + r.weight, 0);
      const entries = weight
        ? weighted
        : [{ o: pendingOffers.at(-1), weight: 1 }];
      for (const entry of entries) {
        const e = c.espp,
          enrollment = e.enrollments?.[entry.o?.grantDate] || {},
          market = Math.max(0.01, enrollment.purchasePrice ?? e.purchasePrice);
        const offer = Math.max(0.01, enrollment.offerPrice ?? e.offerPrice),
          price =
            (e.lookback ? Math.min(offer, market) : market) *
            (1 - Math.min(0.99, Math.max(0, e.discount)));
        const cost = (account("pending") * entry.weight) / (weight || 1),
          shares = cost / price;
        projectedEspp.valuations.push({ cost, price, market, shares });
        projectedEspp.cost += cost;
        projectedEspp.shares += shares;
        projectedEspp.value += shares * market;
      }
      // This is a valuation overlay only. Pending deposits are still cash in the ledger.
      buckets[0].parts = buckets[0].parts.filter(
        (r) => r.label !== labels.pending,
      );
      // Spending drawn from pending ESPP cash moves with it to the Equity bucket.
      const pendingUsed = sum(
        original.links.filter(
          (l) => l.source === "account-pending" && l.target === "costs",
        ),
      );
      buckets[0].value -= projectedEspp.cost;
      buckets[0].used -= pendingUsed;
      buckets[0].remaining = buckets[0].value - buckets[0].used;
      buckets[1].parts.push({
        label: "Projected ESPP equity (not yet purchased)",
        value: projectedEspp.value,
      });
      // Pending cash spent on expenses never buys shares, so only the unspent
      // part keeps its projected purchase value.
      const keptValue =
        projectedEspp.value *
        Math.max(0, 1 - pendingUsed / (projectedEspp.cost || 1));
      buckets[1].remaining += keptValue;
      buckets[1].value += projectedEspp.value;
      buckets[1].used += pendingUsed;
      esppCost += projectedEspp.cost;
      esppValue += projectedEspp.value;
    }
    const pretaxRetirement = incoming("traditional") + incoming("hsa");
    const employer = Math.min(
      positive(p.contributions.employer) +
        positive(p.contributions.hsaEmployer),
      positive(buckets[2].value - pretaxRetirement),
    );
    const postRetirement = positive(
      buckets[2].value - pretaxRetirement - employer,
    );
    const cashTax = sum(
      original.links.filter(
        (l) =>
          l.source === "after-deductions" &&
          l.target !== "after-tax" &&
          l.target !== "rsu-cover",
      ),
    );
    const postBenefits = incoming("benefits-posttax");
    const benefits = incoming("benefits-pretax"),
      rsuCover = incoming("rsu-cover");
    const cashFinal = buckets[0].value,
      rsuRetained = account("rsu"),
      rsuCash = positive(p.rsuGross - rsuCover - rsuRetained);
    // Reconcile secondary receipts, refunds and prior ESPP cash without inventing new wages.
    const cashBeforeDeductions =
      cashFinal +
      postBenefits +
      postRetirement +
      esppCost +
      cashTax +
      pretaxRetirement +
      benefits -
      rsuCash;
    const extraCash = cashBeforeDeductions - p.salary - p.bonus;
    const otherCash = extraCash - (p.cashAllowance || 0);
    const cashParts = [
      { label: "Base salary", value: p.salary },
      { label: "Cash allowances", value: p.cashAllowance || 0 },
    ].filter((r) => Math.abs(r.value) > 0.005);
    buckets[2].parts = [
      { label: "Traditional 401(k)", value: incoming("traditional") },
      {
        label: "Roth 401(k)",
        value: positive(
          account("retirement") -
            incoming("traditional") -
            positive(p.contributions.employer),
        ),
      },
      {
        label: "Employer retirement",
        value: Math.min(
          account("retirement"),
          positive(p.contributions.employer),
        ),
      },
      { label: "Mega backdoor Roth", value: account("mega") },
      { label: "Regular IRA / backdoor Roth", value: account("ira") },
      { label: "HSA (employee + employer)", value: account("hsa") },
    ].filter((r) => r.value > 0);
    return {
      payroll: p,
      config: c,
      buckets,
      projectedEspp,
      rsuBaseline,
      rsuGross: p.rsuGross,
      rsuCover,
      rsuRetained,
      rsuCash,
      esppCost,
      esppValue,
      pretaxRetirement,
      postRetirement,
      employer,
      cashTax,
      benefits,
      postBenefits,
      cashBeforeDeductions,
      cashFinal,
      cashParts,
      base: p.salary + (p.cashAllowance || 0),
      otherCash,
      bonus: p.bonus,
      periodMonth: p.periodMonth,
      year: p.year,
      discount: c.espp.discount,
      expense: original.visualAllocation.costs,
      shortfall: original.visualAllocation.shortfall,
      summary: original.summary,
      original,
    };
  }
  function ribbon(x1, x2, y1, y2, h1, h2) {
    const d = (x2 - x1) * 0.45;
    return `M${x1},${y1} C${x1 + d},${y1} ${x2 - d},${y2} ${x2},${y2} L${x2},${y2 + h2} C${x2 - d},${y2 + h2} ${x1 + d},${y1 + h1} ${x1},${y1 + h1} Z`;
  }
  function layout(g, width) {
    const total = Math.max(
      1,
      positive(g.base) +
        g.bonus +
        Math.max(g.rsuBaseline, g.rsuGross) +
        g.employer,
      ...g.buckets.map((b) => b.value),
    );
    const scale = 260 / total,
      x = (column) => 18 + (column * (width - 170)) / 5,
      links = [],
      nodes = [];
    const node = (
      id,
      label,
      column,
      y,
      value,
      kind,
      parts = [],
      extra = {},
    ) => {
      const n = {
        id,
        label,
        x: x(column),
        y,
        value,
        h: positive(value) * scale,
        kind,
        parts,
        ...extra,
      };
      nodes.push(n);
      return n;
    };
    const link = (
      a,
      b,
      input,
      output,
      kind,
      detail,
      offsetA = 0,
      offsetB = 0,
    ) => {
      if (Math.max(input, output) > 0.005)
        links.push({
          a,
          b,
          input: positive(input),
          output: positive(output),
          kind,
          detail,
          y1: a.y + offsetA * scale,
          y2: b.y + offsetB * scale,
        });
    };
    const sourceBase = node(
      "base",
      Math.abs(
        g.base -
          (g.cashParts.find((p) => p.label === "Base salary")?.value || 0),
      ) > 0.01
        ? "Salary + cash allowances"
        : "Base salary",
      0,
      86,
      positive(g.base),
      "cash",
      g.cashParts,
    );
    const sourceBonus = node(
      "bonus",
      "Bonus",
      0,
      86 + positive(g.base) * scale + 48,
      g.bonus,
      "cash",
    );
    const other = node(
      "other",
      "Other cash / timing",
      0,
      sourceBonus.y + sourceBonus.h + 48,
      positive(g.otherCash),
      "cash",
      [{ label: "Other cash / timing adjustments", value: g.otherCash }],
    );
    const gross = node(
      "gross",
      "Gross cash pay",
      1,
      86,
      positive(g.cashBeforeDeductions),
      "cash",
      g.cashParts,
    );
    link(
      sourceBase,
      gross,
      positive(g.base),
      positive(g.base),
      "cash",
      "Salary, allowances and other cash receipts",
    );
    link(
      sourceBonus,
      gross,
      g.bonus,
      g.bonus,
      "cash",
      "Bonus",
      0,
      positive(g.base),
    );
    link(
      other,
      gross,
      positive(g.otherCash),
      positive(g.otherCash),
      "cash",
      "Other receipts and timing adjustments, separate from salary",
      0,
      positive(g.base) + g.bonus,
    );
    const cash1Value = positive(
        g.cashBeforeDeductions - g.pretaxRetirement - g.benefits,
      ),
      cash2Value = positive(cash1Value - g.cashTax) + g.rsuCash;
    const cash1 = node(
      "cash1",
      "Cash after deductions",
      2,
      86,
      cash1Value,
      "cash",
    );
    const cash2 = node("cash2", "Cash after taxes", 3, 86, cash2Value, "cash");
    const preY = Math.max(
      330,
      86 +
        Math.max(cash1Value, cash2Value) * scale +
        g.cashTax * scale +
        110 +
        g.benefits * scale,
    );
    const pre = node(
      "pretax",
      "Pre-tax contributions",
      2,
      preY,
      g.pretaxRetirement,
      "retirement",
      [
        {
          label: "Traditional 401(k)",
          value: sum(
            g.original.links.filter((l) => l.target === "traditional"),
          ),
        },
        {
          label: "Payroll HSA",
          value: sum(g.original.links.filter((l) => l.target === "hsa")),
        },
      ],
    );
    const prePass = node(
      "prepass",
      "",
      3,
      preY,
      g.pretaxRetirement,
      "retirement",
      [],
      { hidden: true },
    );
    link(
      gross,
      cash1,
      cash1Value,
      cash1Value,
      "cash",
      "Cash after pre-tax contributions and benefits",
      0,
      0,
    );
    const benefitParts = (post) => {
      const grouped = new Map();
      for (const b of g.payroll.benefitDetails || []) {
        if (g.periodMonth && Number(b.date.slice(5, 7)) !== g.periodMonth)
          continue;
        const allowed = post
          ? ["post", "restrictedPost"]
          : ["health", "fsa", "dependentCare", "commuter", "parking"];
        if (allowed.includes(b.category))
          grouped.set(b.label, (grouped.get(b.label) || 0) + b.value);
      }
      const expected = post ? g.postBenefits : g.benefits,
        remainder = expected - [...grouped.values()].reduce((n, v) => n + v, 0);
      if (remainder > 0.01)
        grouped.set("Other benefits / historical amounts", remainder);
      return [...grouped].map(([label, value]) => ({ label, value }));
    };
    const preBenefits = node(
      "pre-benefits",
      "Pre-tax benefits spending",
      2,
      preY - 65 - g.benefits * scale,
      g.benefits,
      "tax",
      benefitParts(false),
    );
    link(
      gross,
      preBenefits,
      g.benefits,
      g.benefits,
      "tax",
      "Coverage, services and restricted benefit funding",
      cash1Value,
    );

    link(
      gross,
      pre,
      g.pretaxRetirement,
      g.pretaxRetirement,
      "retirement",
      "Pre-tax retirement / HSA contributions",
      positive(g.cashBeforeDeductions - g.pretaxRetirement),
    );
    link(
      pre,
      prePass,
      g.pretaxRetirement,
      g.pretaxRetirement,
      "retirement",
      "Pre-tax contributions retained",
    );
    link(
      cash1,
      cash2,
      positive(cash2Value - g.rsuCash),
      positive(cash2Value - g.rsuCash),
      "cash",
      "Cash after payroll taxes and planning tax settlement",
    );
    const tax = node(
      "tax",
      "Cash taxes",
      3,
      86 + cash2Value * scale + 54,
      g.cashTax,
      "tax",
      g.original.nodes
        .filter((n) => /^(withholding|tax-payments|tax-reserve)/.test(n.id))
        .map((n) => ({
          label: n.label,
          value: sum(g.original.links.filter((l) => l.target === n.id)),
        })),
    );
    link(
      cash1,
      tax,
      g.cashTax,
      g.cashTax,
      "tax",
      "Cash withholding, estimated payments and additional tax reserve",
      positive(cash2Value - g.rsuCash),
    );
    const rsuY = Math.max(
      460,
      preY + g.pretaxRetirement * scale + 65,
      (g.otherCash > 0.005
        ? other.y + other.h
        : sourceBonus.y + sourceBonus.h) + 52,
    );
    const rsu0 = node(
      "rsu0",
      "RSUs at grant value",
      0,
      rsuY,
      g.rsuBaseline,
      "equity",
    );
    const rsu1 = node("rsu1", "Gross RSU value", 2, rsuY, g.rsuGross, "equity");
    const rsu2 = node(
      "rsu2",
      "RSUs after withholding",
      3,
      rsuY,
      g.rsuRetained,
      "equity",
    );
    const cover = node(
      "cover",
      "Sell to cover",
      3,
      rsuY + positive(g.rsuGross - g.rsuCover) * scale + 50,
      g.rsuCover,
      "tax",
    );
    link(
      rsu0,
      rsu1,
      g.rsuBaseline,
      g.rsuGross,
      "equity",
      "Scheduled shares revalued from grant price to configured vest price",
    );
    link(
      rsu1,
      rsu2,
      g.rsuRetained,
      g.rsuRetained,
      "equity",
      "Revalued at the configured vest price, after share withholding",
    );
    link(
      rsu1,
      cover,
      g.rsuCover,
      g.rsuCover,
      "tax",
      "RSU sell-to-cover withholding at the configured vest price",
      positive(g.rsuGross - g.rsuCover),
    );
    link(
      rsu1,
      cash2,
      g.rsuCash,
      g.rsuCash,
      "cash",
      "RSU cash proceeds or illustrative funding of a cash shortfall",
      g.rsuRetained,
      positive(cash2Value - g.rsuCash),
    );
    let assetY = 86;
    const assetNodes = g.buckets.map((b) => {
      const n = node(b.id, b.label, 4, assetY, b.value, b.id, b.parts, {
        bucket: b,
      });
      assetY += n.h + 72;
      return n;
    });
    const postBenefits = node(
      "post-benefits",
      "Post-tax benefits spending",
      4,
      assetY,
      g.postBenefits,
      "tax",
      benefitParts(true),
    );
    link(
      cash2,
      postBenefits,
      g.postBenefits,
      g.postBenefits,
      "tax",
      "Post-tax coverage, services and restricted benefit funding",
      g.cashFinal + g.esppCost + g.postRetirement,
    );
    link(
      cash2,
      assetNodes[0],
      g.cashFinal,
      g.cashFinal,
      "cash",
      "Cash before expenses",
    );
    link(
      cash2,
      assetNodes[1],
      g.esppCost,
      g.esppValue,
      "equity",
      g.projectedEspp.cost
        ? "ESPP deductions valued as a hypothetical purchase at configured prices; pending funds are not owned shares"
        : "After-tax ESPP purchase cost grows to market value; the difference is unrealized while held",
      g.cashFinal,
    );
    link(
      rsu2,
      assetNodes[1],
      g.rsuRetained,
      g.rsuRetained,
      "equity",
      "Retained RSU market value",
      0,
      g.esppValue,
    );
    link(
      cash2,
      assetNodes[2],
      g.postRetirement,
      g.postRetirement,
      "retirement",
      "Combined after-tax retirement contributions",
      g.cashFinal + g.esppCost,
    );
    link(
      prePass,
      assetNodes[2],
      g.pretaxRetirement,
      g.pretaxRetirement + g.employer,
      "retirement",
      "Pre-tax contributions plus employer funding",
      0,
      g.postRetirement,
    );
    const costs = node(
      "expenses",
      "Expenses",
      5,
      86,
      g.buckets.reduce((s, b) => s + b.used, 0),
      "tax",
      g.original.visualAllocation.costBreakdown,
    );
    let offset = 0;
    assetNodes.forEach((n, i) => {
      link(
        n,
        costs,
        g.buckets[i].used,
        g.buckets[i].used,
        "tax",
        "Illustrative spending: cash, then equity, then retirement",
        0,
        offset,
      );
      offset += g.buckets[i].used;
    });
    return {
      nodes,
      links,
      scale,
      width,
      height: Math.max(
        560,
        postBenefits.y + postBenefits.h + 40,
        cover.y + cover.h + 35,
        assetY + 5,
      ),
    };
  }
  function details(g, scene, { node: n, link: l }) {
    const p = g.payroll,
      c = g.config,
      checks = (p.paychecks || []).filter(
        (r) => !p.periodMonth || Number(r.date.slice(5, 7)) === p.periodMonth,
      );
    const row = (
      component,
      amount,
      basis,
      basisAmount = null,
      rateKind = "effective",
      total = false,
    ) => ({
      component,
      amount,
      basis,
      basisAmount,
      rate: basisAmount > 0 ? Math.abs(amount) / basisAmount : null,
      rateKind,
      total,
    });
    const eligible = (key) =>
      p.salary +
      ((key === "espp" ? c.espp.bonusEligible : c.retirement.bonusEligible)
        ? p.bonus
        : 0);
    const contribution = (label, value, key) =>
      row(
        label,
        value,
        ["traditional", "roth", "mega", "espp"].includes(key)
          ? "Eligible gross pay"
          : "Account contribution plan",
        ["traditional", "roth", "mega", "espp"].includes(key)
          ? eligible(key)
          : null,
      );
    const componentKeys = {
      "Traditional 401(k)": "traditional",
      "Roth 401(k)": "roth",
      "Mega backdoor Roth": "mega",
      "Regular IRA / backdoor Roth": "ira",
      "Payroll HSA": "hsa",
      "HSA (employee + employer)": "hsa",
    };
    const parts = (parts) =>
      parts.map((r) => contribution(r.label, r.value, componentKeys[r.label]));
    const postParts = g.buckets[2].parts.filter((r) =>
      [
        "Roth 401(k)",
        "Mega backdoor Roth",
        "Regular IRA / backdoor Roth",
      ].includes(r.label),
    );
    const taxRows = () => {
      if (!checks.length)
        return [
          row(
            "Cash withholding and tax adjustment",
            g.cashTax,
            "Cash after pre-tax deductions",
            positive(g.cashBeforeDeductions - g.pretaxRetirement - g.benefits),
            "effective",
          ),
        ];
      const total = (key) => checks.reduce((n, r) => n + (r[key] || 0), 0),
        gross = total("salary") + total("bonus");
      const result = [
        [
          "Federal withholding",
          "federal",
          "Federal taxable wages",
          total("taxableFederal"),
        ],
        ["State withholding", "state", "Gross salary and bonus", gross],
        [
          "Social Security",
          "ss",
          "Payroll taxable wages",
          total("taxablePayroll"),
        ],
        [
          "Medicare",
          "medicare",
          "Payroll taxable wages",
          total("taxablePayroll"),
        ],
        ["State disability", "sdi", "Gross salary and bonus", gross],
      ]
        .map(([label, key, basis, base]) =>
          row(label, total(key), basis, base, "effective withholding"),
        )
        .filter((r) => r.amount);
      const adjustment = g.cashTax - result.reduce((n, r) => n + r.amount, 0);
      if (Math.abs(adjustment) > 0.005)
        result.push(
          row(
            "Additional payments / planning adjustment",
            adjustment,
            "Tax reconciliation",
          ),
        );
      return result;
    };
    const valueRows = (start, end, label, basis, basisAmount) =>
      [
        row(label, start, basis, basisAmount),
        row(
          "Estimated benefit / loss",
          end - start,
          "Starting value",
          start,
          "valuation change",
        ),
        row("Ending value", end, "", null, "", true),
      ].filter((r) => r.amount !== 0 || r.total);
    let rows = [],
      title =
        n?.label ||
        `${l.a.label || "Continuing funds"} → ${l.b.label || "Continuing funds"}`,
      extra = [];
    if (l) {
      const isEspp = l.a.id === "cash2" && l.b.id === "equity";
      const remainder =
        ["cash1", "cash2", "cash"].includes(l.b.id) && l.a.kind === "cash";
      if (["pre-benefits", "post-benefits"].includes(l.b.id))
        rows = parts(l.b.parts).concat(
          row("Total benefits spending", l.output, "", null, "", true),
        );
      else if (l.b.id === "tax")
        rows = taxRows().concat(
          row("Total cash taxes", l.output, "", null, "", true),
        );
      else if (isEspp)
        rows = valueRows(
          l.input,
          l.output,
          "ESPP purchase / projected funding",
          "Eligible gross pay",
          eligible("espp"),
        );
      else if (remainder) {
        rows = [
          row("Starting funds", l.a.value, l.a.label, l.a.value, "starting"),
        ];
        scene.links
          .filter((other) => other.a === l.a && other !== l)
          .forEach((other) =>
            rows.push(
              row(
                other.b.label || "Contributions",
                -other.input,
                l.a.label,
                l.a.value,
                "effective",
              ),
            ),
          );
        if (Math.abs(l.input - l.output) > 0.005)
          rows.push(
            row(
              "Benefits / value adjustment",
              l.output - l.input,
              "Continuing funds",
              l.input,
              "adjustment",
            ),
          );
        rows.push(
          row(
            "Remaining funds",
            l.output,
            l.a.label,
            l.a.value,
            "remaining",
            true,
          ),
        );
      } else if (l.b.id === "pretax")
        rows = parts(l.b.parts).concat(
          row("Total pre-tax contributions", l.output, "", null, "", true),
        );
      else if (l.a.id === "cash2" && l.b.id === "retirement") {
        rows = parts(postParts);
        const other = l.output - sum(postParts);
        if (Math.abs(other) > 0.005)
          rows.push(
            row(
              "Other after-tax contributions",
              other,
              "Account contribution plan",
            ),
          );
        rows.push(
          row("Total after-tax contributions", l.output, "", null, "", true),
        );
      } else if (Math.abs(l.input - l.output) > 0.005)
        rows = valueRows(
          l.input,
          l.output,
          "Starting value",
          l.a.label,
          l.a.value,
        );
      else
        rows = [
          row(
            l.b.label || "Continuing contributions",
            l.output,
            l.a.label || "Contributions carried forward",
            l.a.value,
            l.kind === "tax"
              ? "effective withholding / allocation"
              : "effective",
          ),
        ];
    } else {
      if (n.id === "tax") rows = taxRows();
      else if (n.id === "gross")
        rows = parts([...g.cashParts, { label: "Bonus", value: g.bonus }]);
      else if (n.id === "equity" || n.id === "retirement" || n.id === "cash")
        rows = parts(n.parts);
      else if (n.parts.length) rows = parts(n.parts);
      else rows = [row(n.label, n.value, "Calculated stage total")];
      if (!rows.length)
        rows = [row(n.label, n.value, "Calculated stage total")];
      if (rows.length > 1) rows.push(row("Total", n.value, "", null, "", true));
      if (n.bucket)
        extra = [
          row("Before expenses", n.value, n.label),
          row(
            "Allocated to expenses",
            -n.bucket.used,
            n.label,
            n.value,
            "allocated",
          ),
          row(
            "Remaining",
            n.bucket.remaining,
            n.label,
            n.value,
            "remaining",
            true,
          ),
        ];
      else
        extra = scene.links
          .filter((edge) => edge.a === n)
          .map((edge) =>
            row(
              edge.b.label || "Continuing contributions",
              edge.input,
              n.label,
              n.value,
              "share",
            ),
          );
    }
    if ((l?.a.id === "cash2" && l?.b.id === "equity") || n?.id === "equity") {
      const valuations = g.projectedEspp.valuations.length
        ? g.projectedEspp.valuations
        : (p.espp.lots || [])
            .filter(
              (lot) =>
                Number(lot.purchaseDate.slice(0, 4)) === p.year &&
                (!p.periodMonth ||
                  Number(lot.purchaseDate.slice(5, 7)) === p.periodMonth),
            )
            .map((lot) => ({
              price: lot.shares ? lot.cost / lot.shares : 0,
              market: lot.purchasePrice,
            }));
      valuations.forEach((v, i) => {
        extra.push({
          ...row(
            `Purchase price ${i + 1}`,
            v.price,
            "Configured offering price after discount",
          ),
          unscaled: true,
          unit: "/ share",
        });
        extra.push({
          ...row(
            `Market price ${i + 1}`,
            v.market,
            "Configured purchase-date market assumption",
          ),
          unscaled: true,
          unit: "/ share",
        });
      });
    }
    const relevantKeys =
      l?.b.id === "pretax"
        ? ["traditional", "hsa"]
        : l?.a.id === "cash2" && l?.b.id === "equity"
          ? ["espp"]
          : ["traditional", "roth", "mega", "hsa", "espp"];
    const audit = [];
    for (const check of checks) {
      for (const key of relevantKeys) {
        if (!check[key] && !check.elections?.[key]) continue;
        const e = check.elections?.[key],
          basis =
            check.salary +
            ((
              key === "espp" ? c.espp.bonusEligible : c.retirement.bonusEligible
            )
              ? check.bonus
              : 0);
        const item = row(
          `${check.date}: ${key}`,
          check[key] || 0,
          e?.mode === "fixed"
            ? "Fixed paycheck amount"
            : "Eligible paycheck pay",
          e?.mode === "fixed" ? null : basis,
        );
        if (e?.mode === "percent") item.elected = e.value;
        item.note =
          check.capEvents?.filter((v) => v.startsWith(key + ":")).join("; ") ||
          check.source;
        audit.push(item);
      }
    }
    const source = p.payrollCalendar?.baseline?.record?.date;
    return {
      title,
      rows,
      extra,
      audit,
      source: source
        ? `Latest regular paycheck: ${source}. Actuals are preserved; future amounts follow the baseline and remaining limits.`
        : "Configured compensation and contribution schedule. Rates shown are calculated from the displayed basis.",
      note: l?.detail || "Select a connected ribbon to inspect its transfer.",
      value: l ? l.output : n.value,
    };
  }
  function render(container, g, format) {
    if (!container.clientWidth) return [];
    const divisor = g.periodMonth ? 1 : 12,
      amount = (v) => format(v / divisor),
      period = g.periodMonth
        ? `${g.year}-${String(g.periodMonth).padStart(2, "0")}`
        : "current earning pace (amortized)";
    const scene = layout(g, Math.max(700, container.clientWidth)),
      { width, height, scale } = scene;
    const explain = (input, output) =>
      g.periodMonth
        ? `${format(input)} → ${format(output)} in ${period}`
        : `${format(input)} / year → ${format(output)} / year; ÷ 12 = ${amount(input)} → ${amount(output)} / month`;
    const paths = scene.links
      .map((l, i) => {
        const title = `${l.a.label || "Continuing funds"} → ${l.b.label || "Continuing funds"}: ${explain(l.input, l.output)}. ${l.detail}`;
        const startX = l.a.x + (l.a.hidden ? 0 : 10),
          d = ribbon(
            startX,
            l.b.x,
            l.y1,
            l.y2,
            l.input * scale,
            l.output * scale,
          ),
          bend = (l.b.x - startX) * 0.45;
        return `<g data-compact-flow="${i}" tabindex="0" role="button" aria-label="${escape(title)}"><title>${escape(title)}</title><path class="compact-ribbon" d="${d}" style="fill:${palette[l.kind]}"/><path d="M${startX},${l.y1 + (l.input * scale) / 2} C${startX + bend},${l.y1 + (l.input * scale) / 2} ${l.b.x - bend},${l.y2 + (l.output * scale) / 2} ${l.b.x},${l.y2 + (l.output * scale) / 2}" fill="none" stroke="transparent" stroke-width="18" pointer-events="stroke"/></g>`;
      })
      .join("");
    const wrap = (s) => {
      const lines = [""];
      for (const word of s.split(" ")) {
        if ((lines.at(-1) + " " + word).trim().length > 20) lines.push(word);
        else lines[lines.length - 1] = (lines.at(-1) + " " + word).trim();
      }
      return lines;
    };
    const nodes = scene.nodes
      .filter((n) => !n.hidden && (n.value > 0.005 || n.bucket))
      .map(
        (n) =>
          `<g data-compact-node="${n.id}" tabindex="0" role="button" aria-label="${escape(n.label)}: ${escape(amount(n.value))}. Show breakdown"><rect x="${n.x - 6}" y="${n.y}" width="22" height="${Math.max(8, n.h)}" fill="transparent" pointer-events="all"/><rect x="${n.x - 4}" y="${n.y - 22 - wrap(n.label).length * 13}" width="${Math.min(140, (width - 170) / 5 - 8)}" height="${20 + wrap(n.label).length * 13}" fill="transparent" pointer-events="all"/><rect x="${n.x}" y="${n.y}" width="10" height="${Math.max(2, n.h)}" style="fill:${palette[n.kind]}"/><text x="${n.x}" class="sankey-label">${wrap(
            n.label,
          )
            .map(
              (line, i, lines) =>
                `<tspan x="${n.x}" y="${n.y - 22 - (lines.length - 1 - i) * 13}">${escape(line)}</tspan>`,
            )
            .join(
              "",
            )}</text><text x="${n.x}" y="${n.y - 7}" class="sankey-value">${escape(amount(n.value))}</text>${n.bucket ? `<text x="${n.x}" y="${n.y + n.h + 17}" class="sankey-value">After expenses: ${escape(amount(n.bucket.remaining))}</text>` : ""}</g>`,
      )
      .join("");
    const headers = [
      "Income",
      "Pretax Deductions",
      "Taxes",
      "Post Tax Contributions",
      "Asset additions",
      "Expenses",
    ];
    const annotations = [
      g.rsuGross - g.rsuBaseline
        ? `RSU price change: ${amount(g.rsuGross - g.rsuBaseline)}`
        : "",
      g.esppValue - g.esppCost
        ? `ESPP purchase benefit: ${amount(g.esppValue - g.esppCost)}`
        : "",
      g.employer ? `Employer funding: ${amount(g.employer)}` : "",
      g.benefits ? `Payroll benefits paid: ${amount(g.benefits)}` : "",
    ].filter(Boolean);
    container.innerHTML = `<div class="compact-flow-scroll"><svg viewBox="0 0 ${width} ${height}" role="group" aria-label="Compensation flow: ${period}">${headers
      .map(
        (h, i) =>
          `<text x="${18 + (i * (width - 170)) / 5}" y="16" class="sankey-value">${wrap(
            h,
          )
            .map(
              (line, j) =>
                `<tspan x="${18 + (i * (width - 170)) / 5}" dy="${j ? 13 : 0}">${line}</tspan>`,
            )
            .join("")}</text>`,
      )
      .join(
        "",
      )}${paths}${nodes}</svg></div>${annotations.length ? `<p class="cf-note compact-adjustments">${annotations.map(escape).join(" · ")}</p>` : ""}${g.projectedEspp.cost ? '<span class="context-chip">ESPP includes projected purchase value</span>' : ""}${g.shortfall > 0 ? `<p class="inline-alert">Unfunded expenses: ${escape(amount(g.shortfall))}</p>` : ""}${g.original.visualAllocation.constrainedTransfers > 0 ? '<p class="inline-alert">Asset transfers exceed available cash. Review contributions.</p>' : ""}<div class="compact-detail flow-selection" aria-live="polite">Select a flow for its breakdown.</div>`;
    const panel = container.querySelector(".compact-detail");
    const pendingNote = g.projectedEspp.cost
      ? ` Pending ESPP preview: ${amount(g.projectedEspp.cost)} withheld, approximately ${(g.projectedEspp.shares / divisor).toFixed(4)} share equivalents, projected value ${amount(g.projectedEspp.value)}. This assumes a purchase at configured prices before final share limits and rounding. Actual cash, purchase timing and balances are unchanged. Preview values are not additional income and must not be added to later purchase totals.`
      : "";

    const table = (rows, denominator = divisor) =>
      `<div class="table-scroll"><table class="data-table"><thead><tr><th>Component</th><th>Basis</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${rows.map((r) => `<tr class="${r.total ? "detail-total" : ""}"><td>${escape(r.component)}${r.note ? `<small>${escape(r.note)}</small>` : ""}</td><td>${r.basisAmount != null ? escape(format(r.basisAmount / denominator)) + " " : ""}${escape(r.basis)}</td><td>${r.rate == null ? "-" : `${(r.rate * 100).toFixed(1)}% ${escape(r.rateKind)}`}${r.elected != null ? `<small>${(r.elected * 100).toFixed(1)}% election</small>` : ""}</td><td>${escape(format(r.amount / (r.unscaled ? 1 : denominator)))} ${escape(r.unit || "")}</td></tr>`).join("")}</tbody></table></div>`;
    const highlight = (n, l) => {
      container.classList.add("has-flow-selection");
      container.querySelectorAll("[data-compact-flow]").forEach((el) => {
        const edge = scene.links[Number(el.dataset.compactFlow)],
          active = l ? edge === l : edge.a === n || edge.b === n;
        el.classList.toggle("is-selected", active);
        el.setAttribute("aria-pressed", String(active));
      });
      container.querySelectorAll("[data-compact-node]").forEach((el) => {
        const active = l
          ? [l.a.id, l.b.id].includes(el.dataset.compactNode)
          : el.dataset.compactNode === n.id;
        el.classList.toggle("is-selected", active);
        el.setAttribute("aria-pressed", String(active));
      });
    };
    const show = (selection) => {
      const d = details(g, scene, selection);
      highlight(selection.node, selection.link);
      panel.innerHTML = `<b>${escape(d.title)}</b><p class="detail-period">${escape(period)} · ${escape(amount(d.value))}</p>${table(d.rows)}<details><summary>Calculation details</summary><p class="cf-note">${escape(d.source)}</p>${d.extra.length ? table(d.extra) : ""}${table([{ component: g.periodMonth ? "Selected month" : "Annualized amount", amount: d.value, basis: g.periodMonth ? period : "Monthly average uses 12 months", rate: null, rateKind: "", basisAmount: null }], 1)}${d.audit.length ? table(d.audit, 1) : ""}<p class="cf-note">${escape(d.note)}${escape(pendingNote)}</p></details>`;
    };
    const showNode = (id) => {
      const node = scene.nodes.find((n) => n.id === id);
      if (node) show({ node });
    };
    const select = (i) => {
      const link = scene.links[Number(i)];
      if (link) show({ link });
    };
    container.selectFlow = select;
    container.querySelectorAll("[data-compact-node]").forEach((el) => {
      el.onclick = () => showNode(el.dataset.compactNode);
      el.onkeydown = (e) => {
        if (["Enter", " "].includes(e.key)) {
          e.preventDefault();
          showNode(el.dataset.compactNode);
        }
      };
    });
    container.querySelectorAll("[data-compact-flow]").forEach((el) => {
      el.onclick = () => select(el.dataset.compactFlow);
      el.onkeydown = (e) => {
        if (["Enter", " "].includes(e.key)) {
          e.preventDefault();
          select(el.dataset.compactFlow);
        }
      };
    });
    return scene.links.map((l, i) => [
      `<button class="flow-table-select" data-flow-select="${i}">${escape(l.a.label || "Continuing funds")}</button>`,
      escape(l.b.label || "Continuing funds"),
      `${amount(l.input)}${Math.abs(l.input - l.output) > 0.005 ? ` → ${amount(l.output)}` : ""}`,
    ]);
  }
  const api = { build, layout, ribbon, details, render };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CompactFlow = api;
})(typeof window !== "undefined" ? window : globalThis);
