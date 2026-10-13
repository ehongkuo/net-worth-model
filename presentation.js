(function (root) {
  "use strict";
  function notices(warnings = []) {
    const result = { alerts: [], history: [], tax: [], assumptions: [] };
    for (const text of new Set(warnings)) {
      if (text.startsWith("Earlier paycheck dates")) result.history.push(text);
      else if (/^(California income tax uses|IRA pro-rata inputs)/.test(text))
        result.tax.push(text);
      else if (
        / capped at |^Catch-up contributions moved|^Held RSU taxes|^Unused capital losses/.test(
          text,
        )
      )
        result.assumptions.push(text);
      else result.alerts.push(text);
    }
    return result;
  }
  function overview(payroll, flow, buckets) {
    const assets = (id) => (buckets.find((b) => b.id === id)?.value || 0) / 12;
    return [
      {
        id: "pay",
        label: "Cash pay",
        value:
          ((payroll.salary || 0) +
            (payroll.bonus || 0) +
            (payroll.cashAllowance || 0)) /
          12,
        kind: "cash",
        note: "Salary, bonus and cash allowances",
      },
      {
        id: "rsu",
        label: "RSUs vested",
        value: (payroll.rsuGross || 0) / 12,
        kind: "equity",
        note: "Gross value at assumed share prices",
      },
      {
        id: "tax",
        label: "Taxes",
        value: flow.taxes.total / 12,
        kind: "tax",
        note: "Estimated federal, state and payroll tax",
      },
      {
        id: "cash",
        label: "Cash added",
        value: assets("cash"),
        kind: "cash",
        note: "Before expenses; includes pending ESPP cash and tax reserves",
      },
      {
        id: "equity",
        label: "Equity added",
        value: assets("equity"),
        kind: "equity",
        note: "Retained RSUs and ESPP shares",
      },
      {
        id: "retirement",
        label: "Retirement + HSA",
        value: assets("retirement"),
        kind: "retirement",
        note: "Employee and employer funding",
      },
    ];
  }
  const api = { notices, overview };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Presentation = api;
})(typeof window !== "undefined" ? window : globalThis);
