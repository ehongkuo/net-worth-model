const { test, assert, assertClose, assertEqual } = require("./harness");
const C = require("../compensation"),
  S = require("../scenario"),
  P = require("../profile"),
  Profile = P,
  Projection = require("../projection");

// $120,000 at $50 a share is 2,400 shares vesting quarterly over four years:
// 150 shares on each vest, three of them in 2026 and four in 2027.
const grant = {
  name: "Synthetic grant",
  value: 120000,
  grantPrice: 50,
  vestPrice: 60,
  start: "2026-01-15",
  months: 48,
  cliff: 0,
  interval: 3,
  saleMode: "sell",
  evenVesting: true,
};
const rsu = (extra = {}, grantExtra = {}) =>
  C.merge(C.defaults(), {
    stockGrowth: 0.1,
    grants: [{ ...grant, ...grantExtra }],
    ...extra,
  });

test("without a share price, vests use the grant's own price and growth", () => {
  // 450 shares x $60, then 600 shares x $60 x 1.1.
  assertClose(C.calculate(rsu(), 2026).rsuGross, 27000);
  assertClose(C.calculate(rsu(), 2027).rsuGross, 39600);
});

test("a share price values every future vest at that flat price", () => {
  const c = rsu({ sharePrice: 80 });
  // 450 x $80 and 600 x $80: the 10% growth no longer applies at vest.
  assertClose(C.calculate(c, 2026).rsuGross, 36000);
  assertClose(C.calculate(c, 2027).rsuGross, 48000);
  const vests = C.calculate(c, 2026).rsuVests;
  assertEqual(vests.length, 3);
  assertClose(vests[0].shares, 150);
  assertClose(vests[0].value, 12000);
});

test("held shares still grow after they vest", () => {
  const c = rsu({ sharePrice: 80 }, { saleMode: "hold" });
  assertClose(C.calculate(c, 2026).stockAssets, 36000);
  // 2026 vests grow 10% into 2027; 2027 vests are worth $80 a share.
  assertClose(C.calculate(c, 2027).stockAssets, 36000 * 1.1 + 48000);
});

test("the slider's extremes scale vest value directly", () => {
  // 0.25x and 3x a $40 reference price.
  assertClose(C.calculate(rsu({ sharePrice: 10 }), 2026).rsuGross, 4500);
  assertClose(C.calculate(rsu({ sharePrice: 120 }), 2026).rsuGross, 54000);
});

test("no equity means the share price changes nothing", () => {
  const base = C.merge(C.defaults(), { salary: 100000 });
  const priced = C.merge(C.defaults(), { salary: 100000, sharePrice: 500 });
  assertClose(C.calculate(priced, 2026).gross, C.calculate(base, 2026).gross);
  assertClose(C.calculate(priced, 2026).rsuGross, 0);
});

const espp = (extra = {}, plan = {}) =>
  C.merge(C.defaults(), {
    salary: 120000,
    espp: {
      enabled: true,
      start: "2026-01-01",
      periodMonths: 6,
      rate: 0.1,
      discount: 0.15,
      lookback: true,
      offerPrice: 20,
      purchasePrice: 25,
      salePrice: 25,
      holdMonths: 0,
      fractional: true,
      ...plan,
    },
    ...extra,
  });
const firstLot = (c, year = 2026) =>
  C.calculate(c, year).espp.lots.find((l) => l.grantDate === `${year}-01-01`);

test("ESPP buys at the lookback price and sells at the share price", () => {
  const lot = firstLot(espp({ sharePrice: 30 }));
  // min($20 offering, $30 purchase day) x 85% = $17.
  assertClose(lot.cost / lot.shares, 17);
  assertClose(lot.purchasePrice, 30);
  // The offering price set for the current offering stays: it's a past price.
  assertClose(lot.grantPrice, 20);
  assertClose(lot.proceeds / lot.shares, 30);
});

test("a share price below the offering price sets the purchase price", () => {
  const lot = firstLot(espp({ sharePrice: 16 }));
  // min($20, $16) x 85% = $13.60.
  assertClose(lot.cost / lot.shares, 13.6);
  assertClose(lot.purchasePrice, 16);
});

test("without lookback the discount applies to the share price", () => {
  const lot = firstLot(espp({ sharePrice: 30 }, { lookback: false }));
  assertClose(lot.cost / lot.shares, 25.5);
});

test("offerings after the tax year start at the share price", () => {
  const lot = firstLot(espp({ sharePrice: 30 }), 2027);
  assertClose(lot.grantPrice, 30);
  assertClose(lot.cost / lot.shares, 25.5);
});

test("a per-offering price someone entered still wins", () => {
  const c = espp(
    { sharePrice: 30 },
    { enrollments: { "2026-01-01": { purchasePrice: 22 } } },
  );
  assertClose(firstLot(c).purchasePrice, 22);
});

function scenario(extra = {}) {
  const s = S.defaults();
  s.taxProfile.year = 2026;
  s.compensation.salary = 150000;
  s.compensation.stockGrowth = 0.1;
  s.compensation.grants = [{ ...grant }];
  Object.assign(s.compensation, extra);
  return S.normalize(s);
}

test("a saved scenario without a share price loads unchanged", () => {
  const legacy = S.defaults();
  delete legacy.compensation.sharePrice;
  delete legacy.compensation.referencePrice;
  legacy.compensation.grants = [{ ...grant }];
  const s = S.normalize(legacy);
  assertEqual(s.compensation.sharePrice, 0);
  assertEqual(s.compensation.referencePrice, 0);
  assertEqual(s.compensation.grants[0].vestPrice, 60);
  assertClose(Projection.calculate(s).rows[1].payroll.rsuGross, 27000);
});

test("the slider range is 0.25x to 3x the reference price", () => {
  // The reference is the grant's $50 price; a saved reference is ignored.
  const set = P.sharePrice(scenario({ sharePrice: 70, referencePrice: 40 }));
  assertEqual(set.price, 70);
  assertEqual(set.reference, 50);
  assertEqual(set.min, 12.5);
  assertEqual(set.max, 150);
  assert(set.saved && set.fromGrant);
  // Unset: start from the grant's expected vest price, without saving it.
  const unset = P.sharePrice(scenario());
  assertEqual(unset.price, 60);
  assertEqual(unset.reference, 50);
  assert(!unset.saved);
  // ESPP only: start from its purchase-day price.
  const s = S.defaults();
  s.employerPlan.espp = {
    ...s.employerPlan.espp,
    enabled: true,
    purchasePrice: 18,
  };
  assertEqual(P.sharePrice(S.normalize(s)).price, 18);
  // No equity: no slider.
  assertEqual(P.sharePrice(S.defaults()), null);
});

test("the share price drives the projection and survives export", () => {
  const s = scenario({ sharePrice: 80, referencePrice: 60 });
  const result = Projection.calculate(s);
  assertClose(result.rows[1].payroll.rsuGross, 36000);
  const base = Projection.calculate(scenario({ sharePrice: 60 }));
  assert(
    result.rows.at(-1).netWorth > base.rows.at(-1).netWorth,
    "a higher share price raises lifetime net worth",
  );
  const back = S.normalize(JSON.parse(S.serialize(s)));
  assertEqual(back.compensation.sharePrice, 80);
  assertEqual(back.compensation.referencePrice, 60);
  assertClose(
    Projection.calculate(back).rows.at(-1).netWorth,
    result.rows.at(-1).netWorth,
  );
});

test("share prices must not be negative", () => {
  let error;
  try {
    S.normalize(scenario({ sharePrice: -1 }));
  } catch (e) {
    error = e;
  }
  assert(error && /share price/i.test(error.message));
});

// Two synthetic grants and an ESPP, with prices entered as a user would.
function twoGrants(extra = {}) {
  const s = S.defaults();
  s.compensation.grants = [
    { ...grant, name: "Older", start: "2024-03-01", grantPrice: 30 },
    { ...grant, name: "Newer", start: "2026-02-01", grantPrice: 45 },
  ];
  s.employerPlan.espp = {
    ...s.employerPlan.espp,
    enabled: true,
    offerPrice: 20,
    purchasePrice: 25,
  };
  s.uploads.manualFields = [
    "compensation.grants.0.grantPrice",
    "compensation.grants.1.grantPrice",
  ];
  Object.assign(s.compensation, extra);
  return S.normalize(s);
}

test("vests and ESPP purchases share one price", () => {
  const saved = S.engineInput(twoGrants({ sharePrice: 40 }));
  assertEqual(saved.grants[0].vestPrice, 40);
  assertEqual(saved.grants[1].vestPrice, 40);
  assertEqual(saved.espp.purchasePrice, 40);
  assertEqual(saved.espp.salePrice, 40);
  // Unsaved, the newest grant's $60 vest price is used for both too.
  const unsaved = S.engineInput(twoGrants());
  assertEqual(unsaved.espp.purchasePrice, 60);
  assertEqual(unsaved.grants[0].vestPrice, 60);
  // The offering's start price is a past price and stays.
  assertEqual(unsaved.espp.offerPrice, 20);
});

test("the reference is the most recent grant's price", () => {
  assertEqual(P.sharePrice(twoGrants({ sharePrice: 40 })).reference, 45);
  // An entered grant price wins over a newer placeholder.
  const s = twoGrants();
  s.uploads.manualFields = ["compensation.grants.0.grantPrice"];
  assertEqual(P.sharePrice(s).reference, 30);
  // Only an ESPP: the reference is today's price.
  const e = twoGrants({ sharePrice: 22 });
  e.compensation.grants = [];
  const p = P.sharePrice(e);
  assertEqual(p.reference, 22);
  assert(!p.fromGrant);
});

test("the ESPP question needs only the offering price", () => {
  const Presentation = require("../presentation");
  const s = twoGrants();
  const asks = () => Presentation.missing(s).some((m) => m.id === "espp");
  assert(asks());
  Profile.confirm(s, "employerPlan.espp.offerPrice");
  assert(!asks());
});
