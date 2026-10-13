/**
 * Test entry point: `node test/run.js` (or `npm test`).
 * Requires every *.test.js file in this directory, then runs the suite.
 */

const fs = require("fs");
const path = require("path");
const { run } = require("./harness");

const dir = __dirname;
fs.readdirSync(dir)
  .filter((f) => f.endsWith(".test.js"))
  .sort()
  .forEach((f) => require(path.join(dir, f)));

run();
