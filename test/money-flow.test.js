const { test, assert, assertClose } = require("./harness");
const C = require("../compensation");
const { buildFlow } = require("../money-flow");
function flow(patch = {}, options = {}) {
  const p = C.calculate(C.merge(C.defaults(), patch), 2026);
  return buildFlow(p, C.cashFlow(p, options));
}
test("Sankey intermediate nodes conserve cash and expose take-home", () => {
  const graph = flow(
    {
      salary: 120000,
      retirement: { traditional: 24500, ira: 7500, iraMode: "backdoor" },
      hsa: { employee: 4400 },
      espp: { enabled: true, holdShares: true },
    },
    { expenses: 36000 },
  );
  for (const node of graph.nodes.filter((n) => n.kind === "hub")) {
    const incoming = graph.links
      .filter((l) => l.target === node.id)
      .reduce((n, l) => n + l.value, 0);
    const outgoing = graph.links
      .filter((l) => l.source === node.id)
      .reduce((n, l) => n + l.value, 0);
    assertClose(incoming, outgoing, 0.001, node.id);
  }
  assert(graph.summary.assetTransfers > 0);
  assert(graph.summary.takeHome > 0);
});
test("negative cash flow appears as required funding, not negative Sankey links", () => {
  const graph = flow(
    { salary: 10000, retirement: { traditional: 10000 } },
    { expenses: 60000 },
  );
  assert(graph.summary.fundingNeeded > 0);
  assert(graph.links.every((l) => Number.isFinite(l.value) && l.value > 0));
  assertClose(
    graph.summary.remainingCash - graph.summary.fundingNeeded,
    graph.summary.netCashFlow,
    0.001,
  );
});
test("held RSUs and employer money are non-cash asset additions", () => {
  const graph = flow({
    salary: 120000,
    retirement: { employerAnnual: 5000 },
    grants: [
      {
        value: 12000,
        grantPrice: 100,
        start: "2025-12-31",
        months: 12,
        interval: 3,
        sell: false,
      },
    ],
  });
  assertClose(graph.summary.grossCashPay, 120000);
  assertClose(
    graph.nonCash.reduce((n, r) => n + r.value, 0),
    17000,
  );
});
