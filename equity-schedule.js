(function (root) {
  "use strict";
  const positive = (x) => Math.max(0, Number(x) || 0);
  function addMonths(s, n) {
    const d = new Date(s + "T12:00:00Z"),
      day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    d.setUTCDate(
      Math.min(
        day,
        new Date(
          Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
        ).getUTCDate(),
      ),
    );
    return d.toISOString().slice(0, 10);
  }
  function asOf(year, date) {
    if (date) return date;
    const today = new Date(),
      local = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    return today.getFullYear() === year ? local : `${year}-01-01`;
  }
  function allocations(g) {
    const months = Math.max(1, Math.round(g.months || 48)),
      years = Math.ceil(months / 12);
    if (g.evenVesting !== false)
      return Array.from(
        { length: years },
        (_, i) => (Math.min(12, months - i * 12) / months) * 100,
      );
    const a = g.annualAllocations;
    if (
      !Array.isArray(a) ||
      a.length !== years ||
      a.some((x) => typeof x !== "number" || !Number.isFinite(x) || x < 0) ||
      Math.abs(a.reduce((n, x) => n + x, 0) - 100) > 0.0001
    )
      throw new Error(
        `Annual grant allocations must have ${years} entries totaling 100%.`,
      );
    return [...a];
  }
  function cumulative(g, elapsed) {
    const months = Math.max(1, Math.round(g.months || 48));
    return allocations(g).reduce(
      (n, w, i) =>
        n +
        (w / 100) *
          Math.min(
            1,
            Math.max(0, elapsed - i * 12) / Math.min(12, months - i * 12),
          ),
      0,
    );
  }
  function vests(g) {
    const months = Math.max(1, Math.round(g.months || 48)),
      interval = Math.max(1, Math.round(g.interval || 3)),
      cliff = Math.min(months, positive(g.cliff)),
      out = [];
    let vested = 0;
    for (let elapsed = 1; elapsed <= months; elapsed++) {
      if (
        elapsed < cliff ||
        (elapsed % interval !== 0 && elapsed !== cliff && elapsed !== months)
      )
        continue;
      const fraction = cumulative(g, elapsed) - cumulative(g, vested),
        grantValue = positive(g.value) * fraction,
        shares = grantValue / Math.max(0.01, positive(g.grantPrice) || 100);
      out.push({
        date: addMonths(g.start, elapsed),
        elapsed,
        grantValue,
        shares,
        value:
          shares * (positive(g.vestPrice) || positive(g.grantPrice) || 100),
      });
      vested = elapsed;
    }
    return out;
  }
  function pace(g, date) {
    const months = Math.max(1, Math.round(g.months || 48)),
      end = addMonths(g.start, months),
      weights = allocations(g);
    let phase = -1;
    for (let i = 0; i < weights.length; i++)
      if (
        date >= addMonths(g.start, i * 12) &&
        date < addMonths(g.start, Math.min(months, (i + 1) * 12))
      )
        phase = i;
    const monthlyGrant =
      phase < 0
        ? 0
        : (positive(g.value) * weights[phase]) /
          100 /
          Math.min(12, months - phase * 12);
    return {
      phase: phase + 1,
      monthlyGrant,
      monthlyMarket:
        (monthlyGrant *
          (positive(g.vestPrice) || positive(g.grantPrice) || 100)) /
        Math.max(0.01, positive(g.grantPrice) || 100),
      end,
      nextChange:
        phase < 0
          ? null
          : addMonths(g.start, Math.min(months, (phase + 1) * 12)),
    };
  }
  function instances(grants, through) {
    return grants.flatMap((g, index) =>
      Array.from(
        {
          length: g.repeat
            ? Math.max(
                0,
                Number(through.slice(0, 4)) - Number(g.start.slice(0, 4)) + 1,
              )
            : 1,
        },
        (_, i) => ({
          ...g,
          start: addMonths(g.start, i * 12),
          sourceIndex: index,
        }),
      ),
    );
  }
  function timeline(grants, date, annual = false) {
    const year = Number(date.slice(0, 4)),
      count = annual ? 5 : 20;
    const buckets = Array.from({ length: count }, (_, i) => ({
      year: year - 1 + Math.floor(i / (annual ? 1 : 4)),
      quarter: annual ? null : (i % 4) + 1,
      parts: [],
      total: 0,
    }));
    for (const g of instances(grants, `${year + 3}-12-31`))
      for (const event of vests(g)) {
        const y = Number(event.date.slice(0, 4)),
          q = Math.floor((Number(event.date.slice(5, 7)) - 1) / 3) + 1,
          b = buckets.find((b) => b.year === y && (annual || b.quarter === q));
        if (b) {
          b.parts.push({
            ...event,
            name: g.name || `Grant ${g.sourceIndex + 1}`,
            index: g.sourceIndex,
            vested: event.date <= date,
          });
          b.total += event.value;
        }
      }
    return buckets;
  }
  function esppPace(c, date, contributionOverride) {
    const e = c.espp,
      period = Math.max(1, Math.round(e.periodMonths || 6)),
      zero = {
        monthlyContribution: 0,
        monthlyCost: 0,
        monthlyValue: 0,
        monthlyRefund: 0,
        monthlyShares: 0,
        periodMonths: period,
        active: false,
      };
    if (
      !e.enabled ||
      date < (e.start || date) ||
      (e.employmentStart && date < e.employmentStart) ||
      (e.employmentEnd && date > e.employmentEnd)
    )
      return zero;
    let start = e.start;
    for (let i = 0; i < 1200 && addMonths(start, period) <= date; i++)
      start = addMonths(start, period);
    const election = e.enrollments?.[start] || {};
    if (
      !(
        election.enrolled ??
        ((e.autoEnroll ?? true) &&
          (!e.firstEnrollmentDate || start >= e.firstEnrollmentDate))
      )
    )
      return zero;
    const rate = Math.min(
        e.maxRate ?? 1,
        Math.max(e.minRate ?? 0, election.rate ?? e.rate),
      ),
      eligible = c.salary + (e.bonusEligible ? c.salary * c.bonusPercent : 0),
      annualContribution = Math.min(
        contributionOverride ?? eligible * rate,
        positive(e.annualPayrollCap) || Infinity,
      ),
      cash = (annualContribution * period) / 12,
      gp = Math.max(0.01, election.offerPrice ?? e.offerPrice),
      pp = Math.max(0.01, election.purchasePrice ?? e.purchasePrice),
      discount = Math.min(0.99, positive(e.discount)),
      price = (e.lookback ? Math.min(gp, pp) : pp) * (1 - discount);
    const annualShares = e.qualifiedPlan
      ? Math.min(25000, positive(e.annualFmvLimit ?? 25000)) / gp
      : Infinity;
    let shares = Math.min(
      cash / price,
      positive(e.shareCap) || Infinity,
      (annualShares * period) / 12,
    );
    if (!e.fractional) shares = Math.floor(shares);
    const cost = shares * price;
    return {
      active: true,
      start,
      end: election.end || addMonths(start, period),
      periodMonths: period,
      monthlyContribution: cash / period,
      monthlyCost: cost / period,
      monthlyRefund: (cash - cost) / period,
      monthlyValue: (shares * pp) / period,
      monthlyShares: shares / period,
      price,
      grantPrice: gp,
      marketPrice: pp,
      discount,
      rate,
    };
  }
  const api = {
    addMonths,
    asOf,
    allocations,
    cumulative,
    vests,
    pace,
    instances,
    timeline,
    esppPace,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EquitySchedule = api;
})(typeof window !== "undefined" ? window : globalThis);
