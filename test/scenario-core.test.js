const { test, assert, assertClose } = require("./harness");
const S = require("../scenario");
test("scenario export contains only independent input groups and round-trips exactly", () => {
  const s = S.defaults();
  s.results = { tax: 12 };
  s.uploads.importUndo = { secret: "discard" };
  s.compensation.salary = 123456;
  const json = S.serialize(s),
    restored = S.migrate(JSON.parse(json)).scenario;
  assert(
    JSON.stringify(Object.keys(restored)) ===
      JSON.stringify([
        "schemaVersion",
        "taxProfile",
        "employerPlan",
        "compensation",
        "uploads",
        "projection",
      ]),
  );
  assert(!json.includes("results") && !json.includes("importUndo"));
  assert(S.serialize(restored) === json);
  assertClose(S.engineInput(restored).salary, 123456);
});
test("legacy migration preserves plan, uploads and balances but excludes obsolete events", () => {
  const c = require("../compensation").defaults();
  c.salary = 150000;
  c.tax.filing = "married";
  const legacy = {
    config: {
      compensation: c,
      cash: 2300,
      pretax401kBal: 3400,
      expenses: { housing: 1200 },
    },
    events: [{ type: "career" }],
  };
  const before = JSON.stringify(legacy),
    { scenario: s, warnings } = S.migrate(legacy);
  assertClose(s.projection.startingBalances.cash, 2300);
  assertClose(s.projection.startingBalances.pretax401k, 3400);
  assert(s.taxProfile.settings.filing === "married");
  assert(warnings.length === 1);
  assert(JSON.stringify(legacy) === before);
});
test("scenario rejects unsupported versions and invalid horizons", () => {
  for (const s of [
    { schemaVersion: 99 },
    { ...S.defaults(), projection: { years: 0 } },
  ]) {
    let failed = false;
    try {
      S.migrate(s);
    } catch {
      failed = true;
    }
    assert(failed);
  }
});
test("canonical records strip parser metadata and reject malformed financial inputs", () => {
  const s = S.defaults();
  s.uploads.records = [
    {
      id: "a",
      date: "2026-01-09",
      kind: "regular",
      netPay: 900,
      current: { salary: 1000, unknown: "discard" },
      ytd: { salary: 1000 },
      lines: [{ label: "private label" }],
    },
  ];
  const json = S.serialize(s);
  assert(!json.includes("private label"));
  assert(!json.includes("unknown"));
  for (const patch of [
    { compensation: { salary: -1 } },
    { compensation: { bonusMonth: 13 } },
    { compensation: { firstPayday: "2026-02-30" } },
    { projection: { startingBalances: { cash: null } } },
    { taxProfile: { settings: { filing: "unknown" } } },
  ]) {
    let failed = false;
    try {
      S.normalize(require("../compensation").merge(S.defaults(), patch));
    } catch {
      failed = true;
    }
    assert(failed, JSON.stringify(patch));
  }
});
test("plan features survive export including max elections, reserve settings and offering boundaries", () => {
  const s = S.defaults();
  Object.assign(s.employerPlan.retirement, { max401k: true, maxMega: true });
  Object.assign(s.employerPlan.espp, {
    end: "2026-06-08",
    reserveFutureTax: true,
    reserveSaleMonths: 12,
  });
  const c = S.engineInput(JSON.parse(S.serialize(s)));
  assert(c.retirement.max401k);
  assert(c.espp.reserveFutureTax);
  assertClose(c.espp.reserveSaleMonths, 12);
  assert(c.espp.end === "2026-06-08");
});
