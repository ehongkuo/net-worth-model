const { test, assert, assertClose } = require("./harness");
const C = require("../compensation"),
  S = require("../scenario"),
  P = require("../profile");
const grants = [
  {
    name: "Grant 1",
    value: 100000,
    months: 48,
    start: "2024-01-15",
    cliff: 6,
    interval: 3,
    grantPrice: 20,
    vestPrice: 20,
    evenVesting: true,
  },
  {
    name: "Grant 2",
    value: 200000,
    months: 48,
    start: "2026-02-10",
    cliff: 0,
    interval: 3,
    grantPrice: 20,
    vestPrice: 20,
    evenVesting: false,
    annualAllocations: [40, 30, 20, 10],
  },
];
test("two current allocation years give 8750 monthly independent of vest dates", () => {
  const p = C.ongoing(C.merge(C.defaults(), { grants }), {
    asOf: "2026-09-24",
  });
  assertClose(p.rsuGross / 12, 8750);
});
test("final quarterly vest is a whole 6250 in Q1 2028", () => {
  const E = require("../equity-schedule");
  const events = E.vests(grants[0]);
  assertClose(events.at(-1).grantValue, 6250);
  assert(events.at(-1).date === "2028-01-15");
  assertClose(
    events.reduce((n, v) => n + v.grantValue, 0),
    100000,
  );
});
test("earning pace ends on final vest, retaining rate in December and before January vest", () => {
  const E = require("../equity-schedule");
  for (const date of ["2027-12-20", "2028-01-14"])
    assertClose(E.pace(grants[0], date).monthlyGrant, 25000 / 12);
  assertClose(E.pace(grants[0], "2028-01-15").monthlyGrant, 0);
});
test("custom schedule vests conserve grant and allocate 40 30 20 10 by grant year", () => {
  const E = require("../equity-schedule"),
    events = E.vests(grants[1]);
  for (let year = 0; year < 4; year++)
    assertClose(
      events
        .filter((v) => v.elapsed > year * 12 && v.elapsed <= (year + 1) * 12)
        .reduce((n, v) => n + v.grantValue, 0),
      [80000, 60000, 40000, 20000][year],
    );
});
test("each grant uses its own reference price and grant phase", () => {
  const E = require("../equity-schedule");
  assertClose(
    E.pace({ ...grants[1], vestPrice: 30 }, "2026-09-24").monthlyMarket,
    10000,
  );
  assertClose(E.pace(grants[1], "2027-02-10").monthlyMarket, 5000);
});
test("even toggle preserves custom allocation and updates equal years after duration edit", () => {
  const s = S.defaults();
  s.compensation.grants = [structuredClone(grants[1])];
  P.edit(s, "compensation.grants.0.evenVesting", true);
  const E = require("../equity-schedule");
  assert(E.allocations(s.compensation.grants[0]).join("/") === "25/25/25/25");
  P.edit(s, "compensation.grants.0.evenVesting", false);
  assert(E.allocations(s.compensation.grants[0]).join("/") === "40/30/20/10");
});
test("custom schedules survive scenario export and reject incorrect totals", () => {
  const s = S.defaults();
  s.compensation.grants = structuredClone(grants);
  const copy = S.normalize(JSON.parse(S.serialize(s)));
  assert(
    copy.compensation.grants[1].annualAllocations.join("/") === "40/30/20/10",
  );
  s.compensation.grants[1] = {
    ...grants[1],
    annualAllocations: [40, 30, 20, 20],
  };
  let threw = false;
  try {
    S.normalize(s);
  } catch {
    threw = true;
  }
  assert(threw);
});
test("six month ESPP pace divides cycle value without counting opening contributions", () => {
  const E = require("../equity-schedule"),
    c = C.merge(C.defaults(), {
      salary: 160000,
      espp: {
        enabled: true,
        start: "2026-06-09",
        rate: 0.15,
        periodMonths: 6,
        offerPrice: 14 / 0.85,
        purchasePrice: 17,
        discount: 0.15,
        holdShares: true,
        qualifiedPlan: false,
        fractional: true,
      },
    });
  const p = E.esppPace(c, "2026-09-24");
  assertClose(p.monthlyContribution, 2000);
  assertClose(p.monthlyValue, (2000 / 14) * 17);
  assertClose(p.monthlyCost, 2000);
});
test("qualified ESPP capacity is shared across recurring cycles with refunds", () => {
  const E = require("../equity-schedule"),
    c = C.merge(C.defaults(), {
      salary: 200000,
      espp: {
        enabled: true,
        start: "2026-01-01",
        rate: 0.15,
        periodMonths: 6,
        offerPrice: 20,
        purchasePrice: 20,
        discount: 0.15,
        holdShares: true,
        qualifiedPlan: true,
        annualFmvLimit: 25000,
        fractional: true,
      },
    });
  const p = E.esppPace(c, "2026-09-24");
  assertClose(p.monthlyCost * 12, 21250);
  assertClose(p.monthlyRefund * 12, 8750);
});
test("new custom schedule and duration changes populate equal allocations", () => {
  const s = S.defaults();
  s.compensation.grants = [{ ...grants[0] }];
  P.edit(s, "compensation.grants.0.evenVesting", false);
  assert(
    s.compensation.grants[0].annualAllocations.join("/") === "25/25/25/25",
  );
  P.edit(s, "compensation.grants.0.months", 36);
  assertClose(
    s.compensation.grants[0].annualAllocations.reduce((a, b) => a + b, 0),
    100,
  );
  assert(s.compensation.grants[0].annualAllocations.length === 3);
});
test("quarter timeline preserves total event values and isolates final quarter", () => {
  const E = require("../equity-schedule");
  const b = E.timeline(grants, "2026-09-24");
  assert(b.length === 20);
  assertClose(
    b
      .find((x) => x.year === 2028 && x.quarter === 1)
      .parts.filter((x) => x.index === 0)
      .reduce((n, x) => n + x.value, 0),
    6250,
  );
  assert(
    b
      .filter((x) => x.year === 2028 && x.quarter > 1)
      .every((x) => x.parts.every((p) => p.index !== 0)),
  );
});
test("earning engine carries a complete recurring ESPP cycle into retained assets", () => {
  const c = C.merge(C.defaults(), {
      salary: 160000,
      bonusPercent: 0,
      grants: [],
      espp: {
        enabled: true,
        start: "2026-06-09",
        rate: 0.15,
        periodMonths: 6,
        offerPrice: 14 / 0.85,
        purchasePrice: 17,
        discount: 0.15,
        holdShares: true,
        qualifiedPlan: false,
        fractional: true,
      },
    }),
    p = C.ongoing(c, { asOf: "2026-09-24" });
  assertClose(p.espp.contributions, 24000, 0.2);
  assertClose(
    p.espp.lots.reduce((n, l) => n + l.shares * l.purchasePrice, 0),
    (24000 / 14) * 17,
    0.2,
  );
  assert(
    !p.warnings.some((x) => x.includes("outside the configured offering")),
  );
});
test("dated compensation respects custom grant phase and final expiry", () => {
  const c = C.merge(C.defaults(), { stockGrowth: 0, grants: [grants[1]] });
  assertClose(C.calculate(c, 2026).rsuGross, 60000);
  assertClose(C.calculate(c, 2027).rsuGross, 65000);
  assertClose(C.calculate(c, 2031).rsuGross, 0);
});
test("cliff does not suppress current pace but delays actual vest events", () => {
  const c = C.merge(C.defaults(), {
    grants: [{ ...grants[0], start: "2026-07-15" }],
  });
  assertClose(C.ongoing(c, { asOf: "2026-09-24" }).rsuGross, 25000);
  assertClose(C.calculate(c, 2026).rsuGross, 0);
});
test("earning ESPP refunds preserve cash and respect qualified capacity", () => {
  const c = C.merge(C.defaults(), {
      salary: 200000,
      bonusPercent: 0,
      grants: [],
      espp: {
        enabled: true,
        start: "2026-01-01",
        rate: 0.15,
        periodMonths: 6,
        offerPrice: 20,
        purchasePrice: 20,
        discount: 0.15,
        holdShares: true,
        qualifiedPlan: true,
        annualFmvLimit: 25000,
        fractional: true,
      },
    }),
    p = C.ongoing(c, { asOf: "2026-09-24" });
  assertClose(p.espp.contributions, 30000, 0.2);
  assertClose(p.espp.refunds, 8750, 0.2);
  assertClose(p.espp.lots[0].cost, 21250, 0.2);
  assertClose(p.stockAssets, 25000, 0.2);
});
