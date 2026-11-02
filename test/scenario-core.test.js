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
test("a new scenario is a blank slate: no salary, balances, spending or state", () => {
  const s = S.defaults();
  assert(s.compensation.salary === 0);
  assert(s.taxProfile.settings.state === "");
  assert(Object.values(s.projection.startingBalances).every((v) => v === 0));
  assert(Object.values(s.projection.monthlyExpenses).every((v) => v === 0));
  // An unset state is valid, round-trips and is modelled without state tax.
  const restored = S.normalize(JSON.parse(S.serialize(s)));
  assert(restored.taxProfile.settings.state === "");
  assert(S.engineInput(s).tax.state === "none");
});
test("legacy scenarios without a salary or state keep the old California model", () => {
  const { scenario } = S.migrate({ config: { age: 30 } });
  assert(scenario.compensation.salary === 0);
  assert(scenario.taxProfile.settings.state === "CA");
});
