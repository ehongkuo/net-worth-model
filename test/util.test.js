const { test, assert } = require("./harness");
const Util = require("../util");

test("addMonths clamps to the last day of shorter months", () => {
  assert(Util.addMonths("2026-01-31", 1) === "2026-02-28");
  assert(Util.addMonths("2028-01-31", 1) === "2028-02-29");
  assert(Util.addMonths("2026-03-15", -3) === "2025-12-15");
  assert(Util.addMonths("2026-08-31", 6) === "2027-02-28");
});
test("escape encodes HTML-significant characters and treats null as empty", () => {
  assert(
    Util.escape(`<a href="x">Tom & Jerry's</a>`) ===
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;",
  );
  assert(Util.escape(null) === "" && Util.escape(undefined) === "");
  assert(Util.escape(0) === "0");
});
test("money formats USD with cents and treats non-numbers as zero", () => {
  assert(Util.money(1234.5) === "$1,234.50");
  assert(Util.money(-12) === "-$12.00");
  assert(Util.money(undefined) === "$0.00" && Util.money("abc") === "$0.00");
});
test("positive and clamp coerce bad input to zero", () => {
  assert(
    Util.positive(-3) === 0 &&
      Util.positive("7") === 7 &&
      Util.positive(NaN) === 0,
  );
  assert(
    Util.clamp(5, 0, 1) === 1 &&
      Util.clamp(-1, 0, 1) === 0 &&
      Util.clamp("x", 0, 1) === 0,
  );
});
test("merge deep-merges objects, replaces arrays and ignores prototype keys", () => {
  const out = Util.merge(
    { a: { b: 1, c: 2 }, list: [1, 2] },
    JSON.parse('{"a":{"c":3},"list":[9],"__proto__":{"polluted":true}}'),
  );
  assert(out.a.b === 1 && out.a.c === 3 && out.list.length === 1);
  assert({}.polluted === undefined && out.polluted === undefined);
});

// Minimal DOM stand-ins: enough of Element/Document for preserveFocus.
function fakeDom() {
  const doc = { activeElement: null, body: { tagName: "BODY" } };
  doc.activeElement = doc.body;
  const el = (tagName, attrs = {}, extra = {}) => {
    const node = {
      tagName,
      attrs,
      children: [],
      parentElement: null,
      hasAttribute: (a) => a in attrs,
      getAttribute: (a) => attrs[a] ?? null,
      focus() {
        doc.activeElement = node;
      },
      querySelector: (sel) =>
        sel === "summary"
          ? node.children.find((c) => c.tagName === "SUMMARY")
          : null,
      ...extra,
    };
    return node;
  };
  const container = {
    ownerDocument: doc,
    nodes: [],
    contains: (n) => container.nodes.includes(n),
    querySelectorAll: (sel) => {
      const attr = sel.match(/^\[(.+)\]$/)?.[1];
      if (attr) return container.nodes.filter((n) => n.hasAttribute(attr));
      return container.nodes.filter(
        (n) =>
          n.tagName === "SUMMARY" && n.parentElement?.tagName === "DETAILS",
      );
    },
    render(nodes) {
      container.nodes = nodes;
      if (!nodes.includes(doc.activeElement)) doc.activeElement = doc.body;
    },
  };
  return { doc, el, container };
}
test("preserveFocus refocuses the replacement field and restores its selection", () => {
  const { doc, el, container } = fakeDom();
  const old = el(
    "INPUT",
    { "data-path": "a.b" },
    { selectionStart: 2, selectionEnd: 4, selectionDirection: "forward" },
  );
  container.render([old]);
  old.focus();
  let range;
  const fresh = el(
    "INPUT",
    { "data-path": "a.b" },
    { setSelectionRange: (...r) => (range = r) },
  );
  Util.preserveFocus(container, () =>
    container.render([el("INPUT", { "data-path": "x" }), fresh]),
  );
  assert(doc.activeElement === fresh);
  assert(range.join(",") === "2,4,forward");
});
test("preserveFocus selects number inputs, falls back from confirm buttons, and keys summaries", () => {
  const { doc, el, container } = fakeDom();
  const confirm = el("BUTTON", { "data-confirm": "p.q" });
  container.render([confirm]);
  confirm.focus();
  let selected = false;
  const field = el(
    "INPUT",
    { "data-path": "p.q" },
    { type: "number", selectionStart: null, select: () => (selected = true) },
  );
  Util.preserveFocus(container, () => container.render([field]));
  assert(doc.activeElement === field && selected);

  const details = el("DETAILS"),
    summary = el(
      "SUMMARY",
      {},
      { textContent: "Advanced", parentElement: details },
    );
  details.children.push(summary);
  container.render([summary]);
  summary.focus();
  const details2 = el("DETAILS"),
    summary2 = el(
      "SUMMARY",
      {},
      { textContent: "Advanced", parentElement: details2 },
    );
  details2.children.push(summary2);
  Util.preserveFocus(container, () => container.render([summary2]));
  assert(doc.activeElement === summary2);
});
test("preserveFocus leaves focus alone when it was outside the container", () => {
  const { doc, el, container } = fakeDom();
  const outside = el("BUTTON", { id: "export" });
  outside.focus();
  let rendered = false;
  Util.preserveFocus(container, () => (rendered = true));
  assert(rendered && doc.activeElement === outside);
});
