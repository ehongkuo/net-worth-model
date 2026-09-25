const { test, assertClose } = require("./harness");
const S = require("../scenario"),
  P = require("../projection");
test("starting balances are today and each year-end compounds one year of inflation", () => {
  const s = S.defaults();
  s.projection.years = 3;
  s.projection.inflation = 0.03;
  const rows = P.calculate(s).rows;
  assertClose(rows[0].inflationFactor, 1);
  assertClose(rows[1].inflationFactor, 1.03);
  assertClose(rows[3].inflationFactor, 1.03 ** 3);
  assertClose(rows[1].expenses, 0);
});
