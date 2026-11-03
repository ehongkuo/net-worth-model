const { test, assert } = require("./harness");
const fs = require("fs");
const path = require("path");

// app.js renders inside its startup block. A top-level const or let declared
// below that block is uninitialized when the first render runs, which throws
// and leaves the page without working view tabs.
test("render functions use no top-level state declared after startup", () => {
  const lines = fs
    .readFileSync(path.join(__dirname, "..", "app.js"), "utf8")
    .split("\n");
  const start = lines.findIndex((l) => l.startsWith("try {"));
  assert(start > 0, "startup block found");
  const late = lines
    .slice(start)
    .map((l) => l.match(/^(?:const|let) ([A-Za-z_$][\w$]*)/)?.[1])
    .filter(Boolean);
  const bodies = [];
  lines.forEach((l, i) => {
    if (!/^function /.test(l)) return;
    const end = lines.findIndex((x, j) => j > i && x === "}");
    bodies.push([l, lines.slice(i, end + 1).join("\n")]);
  });
  for (const name of late)
    for (const [head, body] of bodies)
      assert(
        !new RegExp(`\\b${name.replace("$", "\\$")}\\b`).test(body),
        `${head.trim()} uses ${name}, declared after startup`,
      );
});
