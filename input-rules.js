function salaryTiming(payroll, month) {
  const selected = payroll.months.find((m) => m.month === month);
  return {
    checks: selected?.checks || 0,
    annualChecks: payroll.months.reduce((sum, m) => sum + m.checks, 0),
    scheduled: selected?.salary || 0,
    average: payroll.salary / 12,
  };
}
function compensationFieldVisible(c, path) {
  const e = c.espp,
    r = c.retirement,
    h = c.hsa,
    t = c.tax;
  const imported = c.payroll?.enabled ? c.payroll.elections || {} : {};
  if (
    ["retirement.max401k", "retirement.traditional"].includes(path) &&
    imported.traditional
  )
    return false;
  if (["retirement.maxMega", "retirement.mega"].includes(path) && imported.mega)
    return false;
  if (["hsa.maxContribution", "hsa.employee"].includes(path) && imported.hsa)
    return false;
  if (path === "retirement.megaAnnualCap") return r.megaEnabled;
  if (path === "age") return !c.birthday;
  if (path.startsWith("hsa.") && path !== "hsa.eligible")
    return h.eligible && (path !== "hsa.employee" || !h.maxContribution);
  if (path === "retirement.traditional")
    return !r.max401k && !c.payroll?.elections?.traditional;
  if (path === "retirement.maxMega" || path === "retirement.mega")
    return r.megaEnabled && (path !== "retirement.mega" || !r.maxMega);
  if (path === "retirement.ira") return !r.maxIra;
  if (["retirement.iraPretaxBalance", "retirement.iraBasis"].includes(path))
    return r.iraMode === "backdoor";
  if (path.startsWith("espp.") && path !== "espp.enabled") {
    if (!e.enabled) return false;
    if (path === "espp.salePrice" || path === "espp.fee")
      return !e.holdShares || !!e.reserveFutureTax;
    if (path === "espp.holdMonths") return !e.holdShares;
    if (path === "espp.reserveFutureTax")
      return !!e.holdShares && !!e.qualifiedPlan;
    if (path === "espp.reserveSaleMonths")
      return !!e.holdShares && !!e.reserveFutureTax && !!e.qualifiedPlan;
    if (path === "espp.annualFmvLimit" || path === "espp.stopAtAnnualLimit")
      return !!e.qualifiedPlan;
  }
  if (path === "tax.customStateRate") return t.state === "custom";
  if (path === "tax.caGrowth2026" || path === "tax.caSdi")
    return t.state === "CA";
  if (path === "tax.spouseIncome" || path === "tax.spouseFederalWithholding")
    return t.filing === "married";
  if (path.startsWith("tax.w4")) return t.withholdingMethod === "w4";
  if (
    [
      "tax.salaryStateRate",
      "tax.bonusStateRate",
      "tax.rsuStateRate",
      "tax.stateExtra",
      "tax.stateDeduction",
      "tax.stateCredits",
      "tax.stateAdjustment",
      "tax.stateTaxPaid",
    ].includes(path)
  )
    return t.state !== "none";
  return true;
}
if (typeof module !== "undefined")
  module.exports = { compensationFieldVisible, salaryTiming };
