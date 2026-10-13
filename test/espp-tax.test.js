// Known-answer ESPP tests. Scenarios mirror the standalone ESPP-Calculator
// (sell now / hold >1y disqualifying / hold >2y qualifying), worked by hand:
// 100 shares, offering FMV $16.47, purchase FMV $18, 15% discount with lookback,
// so price = 0.85 × 16.47 = $13.9995 and cost = $1,399.95.
const { test, assert } = require("./harness");
const { sellLot } = require("../compensation");
const { esppPurchase, esppFmvLimit } = require("../equity-schedule");

const near = (a, b) => Math.abs(a - b) < 0.005;
const lot = {
  grantDate: "2024-01-01",
  purchaseDate: "2024-06-30",
  shares: 100,
  cost: 1399.95,
  grantPrice: 16.47,
  purchasePrice: 18,
  discount: 0.15,
};
const check = (sale, expected) => {
  for (const [k, v] of Object.entries(expected))
    assert(
      typeof v === "boolean" ? sale[k] === v : near(sale[k], v),
      `${k}: expected ${v}, got ${sale[k]}`,
    );
};

test("sell at purchase: disqualifying, spread is ordinary income, no gain", () => {
  check(sellLot(lot, "2024-06-30", 18), {
    proceeds: 1800,
    ordinary: 400.05,
    shortGain: 0,
    longGain: 0,
    qualified: false,
  });
});
test("hold >1y from purchase but <2y from offering: still disqualifying, rest is long-term", () => {
  check(sellLot(lot, "2025-07-01", 20), {
    ordinary: 400.05,
    longGain: 200,
    shortGain: 0,
    qualified: false,
  });
});
test("disqualifying sale at a loss keeps the full spread as ordinary income", () => {
  check(sellLot(lot, "2024-09-30", 15), {
    ordinary: 400.05,
    shortGain: -300,
    qualified: false,
  });
});
test("qualifying: ordinary income is the offering-date discount when gain exceeds it", () => {
  check(sellLot(lot, "2026-07-01", 20), {
    ordinary: 247.05,
    longGain: 353,
    qualified: true,
  });
});
test("qualifying at a loss: no ordinary income, long-term loss", () => {
  check(sellLot(lot, "2026-07-01", 12), {
    ordinary: 0,
    longGain: -199.95,
    qualified: true,
  });
});
test("sale fee reduces the capital gain, not ordinary income", () => {
  check(sellLot(lot, "2026-07-01", 20, 10), {
    proceeds: 1990,
    ordinary: 247.05,
    longGain: 343,
  });
});
test("non-qualified plan: basis is purchase FMV and the holding period decides the term", () => {
  check(sellLot(lot, "2025-08-01", 20, 0, false), {
    ordinary: 0,
    longGain: 200,
    shortGain: 0,
    qualified: false,
  });
  check(sellLot(lot, "2024-12-31", 20, 0, false), {
    ordinary: 0,
    shortGain: 200,
    longGain: 0,
  });
});

const plan = {
  discount: 0.15,
  lookback: true,
  qualifiedPlan: true,
  fractional: false,
  shareCap: 0,
};
test("purchase uses the lower lookback price and refunds leftover cash", () => {
  const p = esppPurchase(plan, {
    cash: 1500,
    offerPrice: 16.47,
    purchasePrice: 18,
    fmvRoom: 25000,
  });
  assert(near(p.price, 13.9995) && p.shares === 107);
  assert(near(p.refund, 1500 - 107 * 13.9995));
  const noLookback = esppPurchase(
    { ...plan, lookback: false },
    { cash: 1500, offerPrice: 16.47, purchasePrice: 18, fmvRoom: 25000 },
  );
  assert(near(noLookback.price, 15.3));
});
test("purchase is limited by remaining offering-date FMV room and the share cap", () => {
  const args = { cash: 50000, offerPrice: 100, purchasePrice: 120 };
  assert(esppPurchase(plan, { ...args, fmvRoom: 25000 }).shares === 250);
  assert(esppPurchase(plan, { ...args, fmvRoom: 5000 }).shares === 50);
  assert(
    esppPurchase({ ...plan, shareCap: 30 }, { ...args, fmvRoom: 25000 })
      .shares === 30,
  );
  assert(
    esppPurchase({ ...plan, qualifiedPlan: false }, { ...args, fmvRoom: 0 })
      .shares === 588,
  );
});
test("FMV limit is the statutory $25,000 unless the plan sets a lower one", () => {
  assert(esppFmvLimit({}, 2026) === 25000);
  assert(esppFmvLimit({ annualFmvLimit: 10000 }, 2030) === 10000);
  assert(esppFmvLimit({ annualFmvLimit: 40000 }, 2030) === 25000);
});

test("fee only reduces the capital gain when the gain is below the offering discount", () => {
  // Gross gain 200.05 < discount 247.05, so ordinary income is the gross gain.
  check(sellLot(lot, "2026-07-01", 16, 10), {
    proceeds: 1590,
    ordinary: 200.05,
    longGain: -10,
  });
});
test("holding-period boundaries are strict", () => {
  // Exactly one year after purchase is still short-term.
  check(sellLot(lot, "2025-06-30", 20), { shortGain: 200, longGain: 0 });
  // Exactly two years after the offering starts is still disqualifying.
  const late = { ...lot, purchaseDate: "2024-12-31" };
  check(sellLot(late, "2026-01-01", 20), { qualified: false });
  check(sellLot(late, "2026-01-02", 20), { qualified: true });
});
test("non-qualified sale at a loss is a capital loss against purchase-date FMV", () => {
  check(sellLot(lot, "2024-09-30", 15, 0, false), {
    ordinary: 0,
    shortGain: -300,
  });
});
test("a qualified plan with a discount above 15% is flagged", () => {
  const C = require("../compensation");
  const p = C.calculate(
    C.merge(C.defaults(), { espp: { enabled: true, discount: 0.2 } }),
    2026,
  );
  assert(p.warnings.some((w) => w.startsWith("ESPP discount above 15%")));
});
