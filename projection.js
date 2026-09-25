(function (root) {
  "use strict";
  const S =
    typeof module !== "undefined" && module.exports
      ? require("./scenario")
      : root.Scenario;
  const C =
    typeof module !== "undefined" && module.exports
      ? require("./compensation")
      : root.Compensation;
  const sum = (o) => Object.values(o).reduce((n, v) => n + v, 0);
  function draw(balances, need, basis) {
    const b = { ...balances };
    let remaining = Math.max(0, need),
      pretax = 0,
      gains = 0;
    for (const key of [
      "cash",
      "brokerage",
      "companyEquity",
      "pretax401k",
      "traditionalIRA",
      "rothAccounts",
    ]) {
      const take = Math.min(Math.max(0, b[key] || 0), remaining);
      remaining -= take;
      if (key === "pretax401k" || key === "traditionalIRA") pretax += take;
      if (key === "brokerage")
        gains += take * Math.max(0, 1 - basis / Math.max(1, b.brokerage));
      b[key] -= take;
    }
    return { balances: b, pretax, gains, shortfall: remaining };
  }
  function calculate(input) {
    const scenario = S.normalize(input),
      c = S.engineInput(scenario),
      plan = scenario.projection;
    let balances = {
        ...plan.startingBalances,
        companyEquity: 0,
        esppPending: 0,
      },
      basis = balances.brokerage,
      lossCarry = c.tax.capitalLossCarry || 0,
      companyWithdrawn = 0;
    const history = {},
      coverHistory = {},
      rows = [
        {
          year: c.taxYear,
          age: c.age,
          initial: true,
          inflationFactor: 1,
          balances: { ...balances },
          netWorth: sum(balances),
          netCashFlow: 0,
          shortfall: 0,
        },
      ];
    for (let offset = 0; offset < plan.years; offset++) {
      const year = c.taxYear + offset,
        age = c.age + offset,
        employed = age < plan.retirementAge,
        inflationFactor = (1 + plan.inflation) ** offset;
      const payroll = C.calculate(c, year, {
        employed,
        history,
        coverHistory,
        stopYear: c.taxYear + plan.retirementAge - c.age,
        iraStartingBalance: balances.traditionalIRA,
        iraPretaxBalance:
          balances.traditionalIRA + (c.retirement.iraPretaxBalance || 0),
        capitalLossCarry: lossCarry,
      });
      history[year] = {
        employed,
        salary: payroll.salary,
        bonusPercent: c.bonusPercent,
        rsuSellToCover: payroll.rsuSellToCover,
      };
      const expenses = sum(plan.monthlyExpenses) * 12 * inflationFactor,
        socialSecurity =
          age >= plan.socialSecurityStartAge
            ? plan.socialSecurityAnnual * inflationFactor
            : 0;
      for (const key of [
        "brokerage",
        "pretax401k",
        "rothAccounts",
        "traditionalIRA",
        "hsa",
      ])
        balances[key] *= 1 + plan.marketReturn;
      const a = payroll.contributions;
      balances.pretax401k += a.traditional + a.employer;
      balances.rothAccounts +=
        a.roth +
        a.mega +
        (c.retirement.iraMode === "traditional" ? 0 : a.ira) +
        a.conversionEarnings;
      if (c.retirement.iraMode === "traditional")
        balances.traditionalIRA += a.ira;
      balances.hsa += a.hsa + a.hsaEmployer;
      const purchaseCost = payroll.espp.lots
        .filter((l) => Number(l.purchaseDate.slice(0, 4)) === year)
        .reduce((n, l) => n + l.cost, 0);
      balances.esppPending = Math.max(
        0,
        balances.esppPending +
          payroll.espp.contributions -
          payroll.espp.refunds -
          purchaseCost,
      );
      companyWithdrawn *= 1 + c.stockGrowth;
      balances.companyEquity = Math.max(
        0,
        payroll.stockAssets - balances.esppPending - companyWithdrawn,
      );
      const taxFor = (pre, gain) =>
        C.tax(
          {
            ...payroll.income,
            ordinary: payroll.income.ordinary + pre,
            longGain: payroll.income.longGain + gain,
            federalOnly: socialSecurity * 0.85,
          },
          year,
          c.tax,
        );
      let taxes = taxFor(0, 0),
        flow = C.cashFlow(payroll, { taxes, expenses, socialSecurity }),
        withdrawal;
      const baselineCash = flow.netCashFlow,
        baselineTax = taxes.total;
      for (let i = 0; i < 40; i++) {
        withdrawal = draw(
          balances,
          -baselineCash + taxes.total - baselineTax,
          basis,
        );
        const next = taxFor(withdrawal.pretax, withdrawal.gains);
        if (Math.abs(next.total - taxes.total) < 0.005) {
          taxes = next;
          break;
        }
        taxes = next;
      }
      flow = C.cashFlow(payroll, { taxes, expenses, socialSecurity });
      withdrawal = draw(balances, -flow.netCashFlow, basis);
      if (flow.netCashFlow >= 0) balances.cash += flow.netCashFlow;
      else {
        const brokerUsed = balances.brokerage - withdrawal.balances.brokerage;
        basis = Math.max(0, basis - brokerUsed + withdrawal.gains);
        companyWithdrawn +=
          balances.companyEquity - withdrawal.balances.companyEquity;
        balances = withdrawal.balances;
      }
      lossCarry = taxes.lossCarryforward || 0;
      rows.push({
        year,
        age,
        initial: false,
        inflationFactor: inflationFactor * (1 + plan.inflation),
        payroll,
        flow,
        taxes,
        expenses,
        socialSecurity,
        netCashFlow: flow.netCashFlow,
        shortfall: withdrawal.shortfall,
        balances: { ...balances },
        netWorth: sum(balances),
      });
    }
    const ongoingPayroll = C.ongoing(c, {
      iraStartingBalance: plan.startingBalances.traditionalIRA,
      iraPretaxBalance:
        plan.startingBalances.traditionalIRA +
        (c.retirement.iraPretaxBalance || 0),
    });
    const ongoing = {
      payroll: ongoingPayroll,
      flow: C.cashFlow(ongoingPayroll, {
        expenses: sum(plan.monthlyExpenses) * 12,
      }),
    };
    return { scenario, rows, ongoing };
  }
  const api = { calculate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Projection = api;
})(typeof window !== "undefined" ? window : globalThis);
