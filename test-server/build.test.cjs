const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { build } = require("../scripts/build");
const { emptyDefaults } = require("../site-files");
test("static build has every page asset, headers and no personal preset", () => {
  const dist = build(fs.mkdtempSync(path.join(os.tmpdir(), "nwm-dist-")));
  try {
    const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
    for (const [, src] of html.matchAll(/(?:src|href)="([^"]+)"/g))
      assert(fs.existsSync(path.join(dist, src)), `${src} is not built`);
    const app = fs.readFileSync(path.join(dist, "app.js"), "utf8");
    for (const [, src] of app.matchAll(/"\.\/(vendor\/[^"]+)"/g))
      assert(fs.existsSync(path.join(dist, src)), `${src} is not built`);
    assert.equal(
      fs.readFileSync(path.join(dist, "development-defaults.js"), "utf8"),
      emptyDefaults,
    );
    assert(!fs.existsSync(path.join(dist, "node_modules")));
    assert.match(
      fs.readFileSync(path.join(dist, "_headers"), "utf8"),
      /Content-Security-Policy: default-src 'self'/,
    );
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});
