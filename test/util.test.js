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
